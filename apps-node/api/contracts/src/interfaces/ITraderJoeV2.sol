pragma solidity >=0.6;
pragma experimental ABIEncoderV2;

/// @dev ITraderJoeV2Pool is the same as ILBPair in the traderjoe-xyz/joe-v2 codebase. Renamed to avoid name clash.
interface ITraderJoeV2Pool {
    /// @dev Structure to store the protocol fees:
    /// - binStep: The bin step
    /// - baseFactor: The base factor
    /// - filterPeriod: The filter period, where the fees stays constant
    /// - decayPeriod: The decay period, where the fees are halved
    /// - reductionFactor: The reduction factor, used to calculate the reduction of the accumulator
    /// - variableFeeControl: The variable fee control, used to control the variable fee, can be 0 to disable them
    /// - protocolShare: The share of fees sent to protocol
    /// - maxVolatilityAccumulated: The max value of volatility accumulated
    /// - volatilityAccumulated: The value of volatility accumulated
    /// - volatilityReference: The value of volatility reference
    /// - indexRef: The index reference
    /// - time: The last time the accumulator was called
    struct FeeParameters {
        // 144 lowest bits in slot
        uint16 binStep;
        uint16 baseFactor;
        uint16 filterPeriod;
        uint16 decayPeriod;
        uint16 reductionFactor;
        uint24 variableFeeControl;
        uint16 protocolShare;
        uint24 maxVolatilityAccumulated;
        // 112 highest bits in slot
        uint24 volatilityAccumulated;
        uint24 volatilityReference;
        uint24 indexRef;
        uint40 time;
    }

    /// @notice View function to get the fee parameters
    /// @return The fee parameters
    function feeParameters() external view returns (FeeParameters memory);

    /// @notice View function to get the reserves and active id
    /// @return reserveX The reserve of asset X
    /// @return reserveY The reserve of asset Y
    /// @return activeId The active id of the pair
    function getReservesAndId() external view returns (uint256 reserveX, uint256 reserveY, uint256 activeId);
}

/// @dev ITraderJoeV2Factory is the same as LBFactory int he traderjoe-xyz/joe-v2 codebase. Renamed to avoid name clash.
interface ITraderJoeV2Factory {
    /// @dev Structure to store the pool information, such as:
    /// - binStep: The bin step of the LBPair
    /// - pool: The address of the pool
    /// - createdByOwner: Whether the pair was created by the owner of the factory
    /// - ignoredForRouting: Whether the pair is ignored for routing or not. An ignored pair will not be explored during routes finding
    struct PoolInformation {
        uint16 binStep;
        address pool;
        bool createdByOwner;
        bool ignoredForRouting;
    }

    /// @notice View function to return all the LBPair of a pair of tokens
    /// @param tokenX The first token of the pair
    /// @param tokenY The second token of the pair
    /// @return LBPairsAvailable The list of available LBPairs
    function getAllLBPairs(address tokenX, address tokenY) external view returns (PoolInformation[] memory);
}
