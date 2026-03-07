// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPolicyNFTMinimal {
    function ownerOf(uint256 tokenId) external view returns (address);
    function payoutOf(uint256 policyId) external view returns (uint128);
    function statusOf(uint256 policyId) external view returns (uint8); // enum as uint8
}

/// @notice USDC reserve vault enforcing solvency and paying claims to NFT owner.
contract PolicyVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --------- Errors ----------
    error NotReceiver();
    error InvalidAddress();
    error InvalidAmount();
    error Insolvent();
    error InvalidPolicyStatus();
    error BadReserveRatio();

    // --------- Constants ----------
    uint16 private constant BPS_DENOM = 10_000;

    // --------- Storage ----------
    IERC20 public immutable usdc;
    address public creReceiver;
    address public policyNft;

    uint256 public totalActiveLiabilityUSDC; // 6 decimals (sum of payouts for ACTIVE policies)
    uint16 public minReserveRatioBps; // e.g., 11000 = 110%

    // --------- Events ----------
    event CREReceiverUpdated(address indexed receiver);
    event PolicyNFTUpdated(address indexed policyNft);
    event MinReserveRatioUpdated(uint16 ratioBps);

    event LiabilityIncreased(
        uint256 indexed policyId,
        uint256 payoutUSDC,
        uint256 newTotalLiability
    );
    event LiabilityDecreased(
        uint256 indexed policyId,
        uint256 payoutUSDC,
        uint256 newTotalLiability
    );
    event ClaimPaid(
        uint256 indexed policyId,
        address indexed to,
        uint256 amountUSDC
    );
    event SurplusWithdrawn(address indexed to, uint256 amountUSDC);

    modifier onlyReceiver() {
        if (msg.sender != creReceiver) revert NotReceiver();
        _;
    }

    constructor(
        IERC20 usdc_,
        uint16 minReserveRatioBps_,
        address owner_
    ) Ownable(owner_) {
        if (address(usdc_) == address(0)) revert InvalidAddress();
        usdc = usdc_;

        // Bound ratio for safety: [100%, 200%] by default.
        if (minReserveRatioBps_ < BPS_DENOM || minReserveRatioBps_ > 20_000)
            revert BadReserveRatio();
        minReserveRatioBps = minReserveRatioBps_;
        emit MinReserveRatioUpdated(minReserveRatioBps_);
    }

    // --------- Admin ----------
    function setCREReceiver(address receiver_) external onlyOwner {
        if (receiver_ == address(0)) revert InvalidAddress();
        creReceiver = receiver_;
        emit CREReceiverUpdated(receiver_);
    }

    function setPolicyNFT(address policyNft_) external onlyOwner {
        if (policyNft_ == address(0)) revert InvalidAddress();
        policyNft = policyNft_;
        emit PolicyNFTUpdated(policyNft_);
    }

    function setMinReserveRatioBps(uint16 ratioBps) external onlyOwner {
        if (ratioBps < BPS_DENOM || ratioBps > 20_000) revert BadReserveRatio();
        minReserveRatioBps = ratioBps;
        emit MinReserveRatioUpdated(ratioBps);
    }

    function _requiredReservesFor(uint256 liability) internal view returns (uint256) {
        // ceil(liability * ratio / 10000) to avoid underestimating required reserves.
        return
            (liability * uint256(minReserveRatioBps) + BPS_DENOM - 1) /
            BPS_DENOM;
    }

    // --------- Views ----------
    function requiredReserves() public view returns (uint256) {
        return _requiredReservesFor(totalActiveLiabilityUSDC);
    }

    function isSolvent() external view returns (bool) {
        return usdc.balanceOf(address(this)) >= requiredReserves();
    }

    // --------- Receiver-only core ----------
    /// @notice Called immediately after mint. Enforces INV-2 (can’t underwrite without reserves).
    function activatePolicy(uint256 policyId) external onlyReceiver {
        address nft = policyNft;
        if (nft == address(0)) revert InvalidAddress();

        // Policy must be ACTIVE at activation time.
        // Status enum in PolicyNFT: NONE=0, ACTIVE=1, PAID=2, RESOLVED_NO_PAYOUT=3
        uint8 st = IPolicyNFTMinimal(nft).statusOf(policyId);
        if (st != 1) revert InvalidPolicyStatus();

        uint256 payoutUSDC = uint256(IPolicyNFTMinimal(nft).payoutOf(policyId));
        if (payoutUSDC == 0) revert InvalidAmount();

        // Check reserves BEFORE increasing liability: B >= (L + P) * R
        uint256 newLiability = totalActiveLiabilityUSDC + payoutUSDC;
        uint256 required = _requiredReservesFor(newLiability);

        if (usdc.balanceOf(address(this)) < required) revert Insolvent();

        totalActiveLiabilityUSDC = newLiability;
        emit LiabilityIncreased(policyId, payoutUSDC, newLiability);
    }

    /// @notice Decrements liability when policy resolves without payout.
    function resolvePolicyNoPayout(uint256 policyId) external onlyReceiver {
        address nft = policyNft;
        if (nft == address(0)) revert InvalidAddress();

        // Must still be ACTIVE when resolving.
        uint8 st = IPolicyNFTMinimal(nft).statusOf(policyId);
        if (st != 1) revert InvalidPolicyStatus();

        uint256 payoutUSDC = uint256(IPolicyNFTMinimal(nft).payoutOf(policyId));
        if (payoutUSDC == 0) revert InvalidAmount();

        // Decrement liability
        uint256 L = totalActiveLiabilityUSDC;
        // Underflow protected by solidity 0.8 checks (should never happen if invariant holds)
        uint256 newLiability = L - payoutUSDC;
        totalActiveLiabilityUSDC = newLiability;

        emit LiabilityDecreased(policyId, payoutUSDC, newLiability);
        // No further solvency check needed; liability decreased.
    }

    /// @notice Pays claim to current NFT owner (soulbound => minter) and decrements liability first.
    function payClaim(uint256 policyId) external onlyReceiver nonReentrant {
        address nft = policyNft;
        if (nft == address(0)) revert InvalidAddress();

        // Must be ACTIVE at payout time.
        uint8 st = IPolicyNFTMinimal(nft).statusOf(policyId);
        if (st != 1) revert InvalidPolicyStatus();

        uint256 payoutUSDC = uint256(IPolicyNFTMinimal(nft).payoutOf(policyId));
        if (payoutUSDC == 0) revert InvalidAmount();

        address to = IPolicyNFTMinimal(nft).ownerOf(policyId);
        if (to == address(0)) revert InvalidAddress();

        // Decrement liability FIRST (prevents reentrancy accounting issues)
        uint256 newLiability = totalActiveLiabilityUSDC - payoutUSDC;
        totalActiveLiabilityUSDC = newLiability;
        emit LiabilityDecreased(policyId, payoutUSDC, newLiability);

        // Transfer USDC
        usdc.safeTransfer(to, payoutUSDC);
        emit ClaimPaid(policyId, to, payoutUSDC);

        // Optional: enforce post-condition solvency
        // (not strictly necessary since liability decreased, but good invariant signal)
        // if (usdc.balanceOf(address(this)) < requiredReserves()) revert Insolvent();
    }

    // --------- Owner withdrawals constrained by reserves ----------
    function withdrawSurplus(
        address to,
        uint256 amountUSDC
    ) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        if (amountUSDC == 0) revert InvalidAmount();

        uint256 bal = usdc.balanceOf(address(this));
        uint256 req = requiredReserves();

        // Must remain solvent after withdrawal: bal - amount >= req
        if (bal < amountUSDC) revert InvalidAmount();
        if (bal - amountUSDC < req) revert Insolvent();

        usdc.safeTransfer(to, amountUSDC);
        emit SurplusWithdrawn(to, amountUSDC);
    }
}
