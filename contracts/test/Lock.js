const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");

const REPORT_TYPE =
  "tuple(uint8 action,uint256 policyId,tuple(address to,string eventId,bytes32 eventIdHash,uint64 eventStart,uint64 coverageStart,uint64 coverageEnd,uint64 quoteExpiry,uint128 payoutUSDC,uint128 premiumUSDC) mint)";

function encodeReport(report) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  return abi.encode([REPORT_TYPE], [report]);
}

function mkMintData(to, eventId, now, payoutUSDC, premiumUSDC, coverageEndOffsetSec = 86400 * 2) {
  return {
    to,
    eventId,
    eventIdHash: ethers.keccak256(ethers.toUtf8Bytes(eventId)),
    eventStart: now + 86400,
    coverageStart: now,
    coverageEnd: now + coverageEndOffsetSec,
    quoteExpiry: now + 3600,
    payoutUSDC,
    premiumUSDC,
  };
}

function emptyMint() {
  return {
    to: ethers.ZeroAddress,
    eventId: "",
    eventIdHash: ethers.ZeroHash,
    eventStart: 0,
    coverageStart: 0,
    coverageEnd: 0,
    quoteExpiry: 0,
    payoutUSDC: 0,
    premiumUSDC: 0,
  };
}

describe("Microinsurance contracts", function () {
  async function deploySystemFixture() {
    const [owner, forwarder, alice, bob, other] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
    const nft = await PolicyNFT.deploy("Event Policy", "EPOL", owner.address);
    await nft.waitForDeployment();

    const PolicyVault = await ethers.getContractFactory("PolicyVault");
    const vault = await PolicyVault.deploy(await usdc.getAddress(), 11000, owner.address);
    await vault.waitForDeployment();

    const CREReceiver = await ethers.getContractFactory("CREReceiver");
    const receiver = await CREReceiver.deploy(
      owner.address,
      forwarder.address,
      await nft.getAddress(),
      await vault.getAddress(),
    );
    await receiver.waitForDeployment();

    await nft.connect(owner).setReceiver(await receiver.getAddress());
    await vault.connect(owner).setCREReceiver(await receiver.getAddress());
    await vault.connect(owner).setPolicyNFT(await nft.getAddress());

    // 20 USDC funding cap for tests.
    const initialFunding = ethers.parseUnits("20", 6);
    await usdc.mint(owner.address, initialFunding);
    await usdc.connect(owner).transfer(await vault.getAddress(), initialFunding);

    return { owner, forwarder, alice, bob, other, usdc, nft, vault, receiver };
  }

  it("wires contracts correctly", async function () {
    const { nft, vault, receiver } = await loadFixture(deploySystemFixture);

    expect(await nft.receiver()).to.equal(await receiver.getAddress());
    expect(await vault.creReceiver()).to.equal(await receiver.getAddress());
    expect(await vault.policyNft()).to.equal(await nft.getAddress());
  });

  it("blocks unauthorized receiver calls", async function () {
    const { nft, other, alice } = await loadFixture(deploySystemFixture);
    const now = await time.latest();
    const eventId = "event-1";

    await expect(
      nft.connect(other).mintPolicy(
        alice.address,
        eventId,
        ethers.keccak256(ethers.toUtf8Bytes(eventId)),
        now + 3600,
        now,
        now + 7200,
        now + 1800,
        ethers.parseUnits("1", 6),
        ethers.parseUnits("0.1", 6),
      ),
    ).to.be.revertedWithCustomError(nft, "NotReceiver");
  });

  it("simulates CRE MINT and tracks liability", async function () {
    const { forwarder, alice, nft, vault, receiver } = await loadFixture(deploySystemFixture);
    const now = await time.latest();
    const payout = ethers.parseUnits("5", 6);
    const premium = ethers.parseUnits("0.5", 6);

    const mintReport = {
      action: 0, // MINT
      policyId: 0,
      mint: mkMintData(alice.address, "event-mint", now, payout, premium),
    };

    await receiver.connect(forwarder).onReport("0x", encodeReport(mintReport));

    const policyId = (await nft.nextPolicyId()) - 1n;
    expect(await nft.ownerOf(policyId)).to.equal(alice.address);
    expect(await vault.totalActiveLiabilityUSDC()).to.equal(payout);
    expect(await nft.statusOf(policyId)).to.equal(1); // ACTIVE
  });

  it("simulates CRE PAY and transfers payout", async function () {
    const { forwarder, alice, usdc, nft, vault, receiver } = await loadFixture(deploySystemFixture);
    const now = await time.latest();
    const payout = ethers.parseUnits("2", 6);

    const mintReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(alice.address, "event-pay", now, payout, ethers.parseUnits("0.2", 6)),
    };
    await receiver.connect(forwarder).onReport("0x", encodeReport(mintReport));
    const policyId = (await nft.nextPolicyId()) - 1n;

    const balBefore = await usdc.balanceOf(alice.address);
    const payReport = { action: 1, policyId, mint: emptyMint() }; // PAY
    await receiver.connect(forwarder).onReport("0x", encodeReport(payReport));

    const balAfter = await usdc.balanceOf(alice.address);
    expect(balAfter - balBefore).to.equal(payout);
    expect(await nft.statusOf(policyId)).to.equal(2); // PAID
    expect(await vault.totalActiveLiabilityUSDC()).to.equal(0);
  });

  it("reverts RESOLVE before coverageEnd and succeeds after", async function () {
    const { forwarder, bob, usdc, nft, vault, receiver } = await loadFixture(deploySystemFixture);
    const now = await time.latest();
    const payout = ethers.parseUnits("3", 6);

    const mintReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(bob.address, "event-resolve", now, payout, ethers.parseUnits("0.3", 6), 120),
    };
    await receiver.connect(forwarder).onReport("0x", encodeReport(mintReport));
    const policyId = (await nft.nextPolicyId()) - 1n;

    const resolveReport = { action: 2, policyId, mint: emptyMint() }; // RESOLVE
    await expect(receiver.connect(forwarder).onReport("0x", encodeReport(resolveReport))).to.be.revertedWithCustomError(
      nft,
      "CoverageNotEnded",
    );

    await time.increase(121);

    const balBefore = await usdc.balanceOf(bob.address);
    await receiver.connect(forwarder).onReport("0x", encodeReport(resolveReport));
    const balAfter = await usdc.balanceOf(bob.address);

    expect(balAfter).to.equal(balBefore);
    expect(await nft.statusOf(policyId)).to.equal(3); // RESOLVED_NO_PAYOUT
    expect(await vault.totalActiveLiabilityUSDC()).to.equal(0);
  });

  it("reverts MINT when vault would become insolvent", async function () {
    const { forwarder, alice, receiver, vault } = await loadFixture(deploySystemFixture);
    const now = await time.latest();

    const tooLargePayout = ethers.parseUnits("19", 6); // 19 * 110% = 20.9 > 20 funded
    const mintReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(alice.address, "event-insolvent", now, tooLargePayout, ethers.parseUnits("0.5", 6)),
    };

    await expect(
      receiver.connect(forwarder).onReport("0x", encodeReport(mintReport)),
    ).to.be.revertedWithCustomError(vault, "Insolvent");
  });

  it("uses ceil reserve math for requiredReserves", async function () {
    const { forwarder, alice, receiver, vault } = await loadFixture(deploySystemFixture);
    const now = await time.latest();

    const oneUnitPayout = 1n;
    const mintReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(alice.address, "event-ceil", now, oneUnitPayout, 1n),
    };

    await receiver.connect(forwarder).onReport("0x", encodeReport(mintReport));

    // ceil(1 * 11000 / 10000) = 2
    expect(await vault.requiredReserves()).to.equal(2n);

    // With 20,000,000 balance and 11000 bps ratio, this is the first payout that should fail under ceil math.
    const edgeRevertPayout = 18181819n;
    const edgeReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(alice.address, "event-ceil-edge", now, edgeRevertPayout, 1n),
    };

    await expect(
      receiver.connect(forwarder).onReport("0x", encodeReport(edgeReport)),
    ).to.be.revertedWithCustomError(vault, "Insolvent");
  });

  it("enforces surplus withdrawals to remain solvent", async function () {
    const { owner, forwarder, alice, receiver, vault } = await loadFixture(deploySystemFixture);
    const now = await time.latest();

    const mintReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(alice.address, "event-withdraw", now, ethers.parseUnits("5", 6), ethers.parseUnits("0.5", 6)),
    };
    await receiver.connect(forwarder).onReport("0x", encodeReport(mintReport));

    await expect(
      vault.connect(owner).withdrawSurplus(owner.address, ethers.parseUnits("15", 6)),
    ).to.be.revertedWithCustomError(vault, "Insolvent");

    await expect(
      vault.connect(owner).withdrawSurplus(owner.address, ethers.parseUnits("14", 6)),
    ).to.not.be.reverted;
  });

  it("keeps PolicyNFT soulbound", async function () {
    const { forwarder, alice, bob, nft, receiver } = await loadFixture(deploySystemFixture);
    const now = await time.latest();

    const mintReport = {
      action: 0,
      policyId: 0,
      mint: mkMintData(alice.address, "event-soulbound", now, ethers.parseUnits("1", 6), ethers.parseUnits("0.1", 6)),
    };
    await receiver.connect(forwarder).onReport("0x", encodeReport(mintReport));
    const policyId = (await nft.nextPolicyId()) - 1n;

    await expect(nft.connect(alice).transferFrom(alice.address, bob.address, policyId)).to.be.revertedWithCustomError(
      nft,
      "Soulbound",
    );
  });
});
