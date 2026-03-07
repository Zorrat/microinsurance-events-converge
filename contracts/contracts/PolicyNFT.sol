// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Soulbound policy NFT storing immutable-ish policy data (no transfers).
contract PolicyNFT is ERC721, Ownable {
    // --------- Errors (cheaper than revert strings) ----------
    error NotReceiver();
    error Soulbound();
    error InvalidAddress();
    error InvalidTimes();
    error InvalidAmount();
    error EventIdHashMismatch();
    error CoverageNotEnded();
    error InvalidStatus();

    // --------- Policy Types ----------
    enum Status {
        NONE,
        ACTIVE,
        PAID,
        RESOLVED_NO_PAYOUT
    }

    struct Policy {
        bytes32 eventIdHash; // hash(canonical Eventbrite event id)
        string eventId; // canonical Eventbrite event id
        uint64 eventStart; // timestamp (seconds)
        uint64 coverageStart; // seconds
        uint64 coverageEnd; // seconds
        uint64 quoteExpiry; // seconds
        uint128 payoutUSDC; // 6 decimals
        uint128 premiumUSDC; // 6 decimals (optional, but stored for audit/UX)
        address insured; // minter/to
        Status status; // ACTIVE -> terminal
    }

    // --------- Storage ----------
    address public receiver; // CREReceiver
    uint256 public nextPolicyId = 1;

    mapping(uint256 => Policy) private _policies;

    // --------- Events ----------
    event ReceiverUpdated(address indexed receiver);
    event PolicyMinted(
        uint256 indexed policyId,
        address indexed insured,
        bytes32 indexed eventIdHash,
        string eventId,
        uint64 eventStart,
        uint64 coverageStart,
        uint64 coverageEnd,
        uint64 quoteExpiry,
        uint128 payoutUSDC,
        uint128 premiumUSDC
    );
    event PolicyStatusUpdated(uint256 indexed policyId, Status newStatus);

    // --------- Modifiers ----------
    modifier onlyReceiver() {
        if (msg.sender != receiver) revert NotReceiver();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC721(name_, symbol_) Ownable(owner_) {}

    // --------- Admin ----------
    function setReceiver(address receiver_) external onlyOwner {
        if (receiver_ == address(0)) revert InvalidAddress();
        receiver = receiver_;
        emit ReceiverUpdated(receiver_);
    }

    // --------- External Views (cheap) ----------
    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    function statusOf(uint256 policyId) external view returns (Status) {
        return _policies[policyId].status;
    }

    function payoutOf(uint256 policyId) external view returns (uint128) {
        return _policies[policyId].payoutUSDC;
    }

    function premiumOf(uint256 policyId) external view returns (uint128) {
        return _policies[policyId].premiumUSDC;
    }

    // --------- Core Writes (Receiver-only) ----------
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
    ) external onlyReceiver returns (uint256 policyId) {
        if (to == address(0)) revert InvalidAddress();
        if (bytes(eventId).length == 0) revert InvalidAddress();
        if (eventIdHash != keccak256(bytes(eventId))) revert EventIdHashMismatch();
        if (payoutUSDC == 0) revert InvalidAmount();

        // Minimal sanity: coverage must make sense
        if (coverageStart > coverageEnd) revert InvalidTimes();
        // Optional: ensure quote hasn't expired (CRE should also enforce)
        if (quoteExpiry < uint64(block.timestamp)) revert InvalidTimes();

        policyId = nextPolicyId;
        unchecked {
            nextPolicyId = policyId + 1;
        }

        _safeMint(to, policyId);

        _policies[policyId] = Policy({
            eventIdHash: eventIdHash,
            eventId: eventId,
            eventStart: eventStart,
            coverageStart: coverageStart,
            coverageEnd: coverageEnd,
            quoteExpiry: quoteExpiry,
            payoutUSDC: payoutUSDC,
            premiumUSDC: premiumUSDC,
            insured: to,
            status: Status.ACTIVE
        });

        emit PolicyMinted(
            policyId,
            to,
            eventIdHash,
            eventId,
            eventStart,
            coverageStart,
            coverageEnd,
            quoteExpiry,
            payoutUSDC,
            premiumUSDC
        );
    }

    function setStatusPaid(uint256 policyId) external onlyReceiver {
        Policy storage p = _policies[policyId];
        if (p.status != Status.ACTIVE) revert InvalidStatus();
        p.status = Status.PAID;
        emit PolicyStatusUpdated(policyId, Status.PAID);
    }

    function setStatusResolvedNoPayout(uint256 policyId) external onlyReceiver {
        Policy storage p = _policies[policyId];
        if (p.status != Status.ACTIVE) revert InvalidStatus();
        if (uint64(block.timestamp) <= p.coverageEnd) revert CoverageNotEnded();
        p.status = Status.RESOLVED_NO_PAYOUT;
        emit PolicyStatusUpdated(policyId, Status.RESOLVED_NO_PAYOUT);
    }

    // --------- Soulbound Enforcement ----------
    // OZ v5: _update is called for mint/transfer/burn. Revert any transfer between non-zero addresses.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address from) {
        from = super._update(to, tokenId, auth);

        // allow mint (from==0) and (optional) burn (to==0). Disallow transfers.
        if (from != address(0) && to != address(0)) revert Soulbound();
    }

    // Optional: block approvals entirely to reduce attack surface.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
