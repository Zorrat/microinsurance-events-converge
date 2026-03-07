// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IPolicyNFT {
    function mintPolicy(
        address to,
        string memory eventId,
        bytes32 eventIdHash,
        uint64 eventStart,
        uint64 coverageStart,
        uint64 coverageEnd,
        uint64 quoteExpiry,
        uint128 payoutUSDC,
        uint128 premiumUSDC
    ) external returns (uint256 policyId);

    function setStatusPaid(uint256 policyId) external;
    function setStatusResolvedNoPayout(uint256 policyId) external;
}

interface IPolicyVault {
    function activatePolicy(uint256 policyId) external;
    function resolvePolicyNoPayout(uint256 policyId) external;
    function payClaim(uint256 policyId) external;
}

/// @notice Minimal CRE Receiver: forwarder-gated onReport -> decode -> call Vault+NFT.
contract CREReceiver is Ownable, IReceiver {
    error NotForwarder();
    error InvalidAddress();
    error InvalidReport();

    enum Action {
        MINT,
        PAY,
        RESOLVE
    }

    struct MintData {
        address to;
        string eventId;
        bytes32 eventIdHash;
        uint64 eventStart;
        uint64 coverageStart;
        uint64 coverageEnd;
        uint64 quoteExpiry;
        uint128 payoutUSDC;
        uint128 premiumUSDC;
    }

    struct Report {
        Action action;
        uint256 policyId;
        MintData mint;
    }

    address public forwarder;
    address public policyNft;
    address public policyVault;

    event ForwarderUpdated(address indexed forwarder);
    event TargetsUpdated(
        address indexed policyNft,
        address indexed policyVault
    );
    event ReportProcessed(Action indexed action, uint256 indexed policyId);

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert NotForwarder();
        _;
    }

    constructor(
        address owner_,
        address forwarder_,
        address policyNft_,
        address policyVault_
    ) Ownable(owner_) {
        if (
            forwarder_ == address(0) ||
            policyNft_ == address(0) ||
            policyVault_ == address(0)
        ) {
            revert InvalidAddress();
        }
        forwarder = forwarder_;
        policyNft = policyNft_;
        policyVault = policyVault_;
        emit ForwarderUpdated(forwarder_);
        emit TargetsUpdated(policyNft_, policyVault_);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public pure override returns (bool) {
        return
            interfaceId == type(IReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    /// @dev metadata is accepted for CRE compatibility but not parsed in MVP.
    function onReport(
        bytes calldata /*metadata*/,
        bytes calldata report
    ) external override onlyForwarder {
        if (report.length == 0) revert InvalidReport();

        Report memory r = abi.decode(report, (Report));

        if (r.action == Action.MINT) {
            uint256 pid = IPolicyNFT(policyNft).mintPolicy(
                r.mint.to,
                r.mint.eventId,
                r.mint.eventIdHash,
                r.mint.eventStart,
                r.mint.coverageStart,
                r.mint.coverageEnd,
                r.mint.quoteExpiry,
                r.mint.payoutUSDC,
                r.mint.premiumUSDC
            );
            IPolicyVault(policyVault).activatePolicy(pid);
            emit ReportProcessed(Action.MINT, pid);
            return;
        }

        uint256 pid2 = r.policyId;
        if (pid2 == 0) revert InvalidReport();

        if (r.action == Action.PAY) {
            IPolicyVault(policyVault).payClaim(pid2);
            IPolicyNFT(policyNft).setStatusPaid(pid2);
            emit ReportProcessed(Action.PAY, pid2);
            return;
        }

        if (r.action == Action.RESOLVE) {
            IPolicyVault(policyVault).resolvePolicyNoPayout(pid2);
            IPolicyNFT(policyNft).setStatusResolvedNoPayout(pid2);
            emit ReportProcessed(Action.RESOLVE, pid2);
            return;
        }

        revert InvalidReport();
    }

    // Optional admin setters (keep if you want ability to rotate forwarder/targets)
    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert InvalidAddress();
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    function setTargets(
        address policyNft_,
        address policyVault_
    ) external onlyOwner {
        if (policyNft_ == address(0) || policyVault_ == address(0))
            revert InvalidAddress();
        policyNft = policyNft_;
        policyVault = policyVault_;
        emit TargetsUpdated(policyNft_, policyVault_);
    }
}
