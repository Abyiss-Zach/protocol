import { assert } from '@0x/assert';
import { ContractAddresses } from '@0x/contract-addresses';
import { assetDataUtils, generatePseudoRandomSalt } from '@0x/order-utils';
import { SignedOrder } from '@0x/types';
import { AbiEncoder, BigNumber } from '@0x/utils';

import { constants } from '../../constants';

import { constants as marketOperationUtilConstants } from './constants';
import {
    AggregationError,
    CollapsedFill,
    ERC20BridgeSource,
    NativeCollapsedFill,
    OptimizedMarketOrder,
    OrderDomain,
} from './types';

const { NULL_BYTES, NULL_ADDRESS, ZERO_AMOUNT } = constants;
const { INFINITE_TIMESTAMP_SEC, WALLET_SIGNATURE } = marketOperationUtilConstants;

export class CreateOrderUtils {
    private readonly _contractAddress: ContractAddresses;

    // utility function for asset-swapper to ignore market operation utils for specific asset types
    public static convertNativeOrderToFullyFillableOptimizedOrders(order: SignedOrder): OptimizedMarketOrder {
        return {
            ...order,
            fillableMakerAssetAmount: order.makerAssetAmount,
            fillableTakerAssetAmount: order.takerAssetAmount,
            fillableTakerFeeAmount: order.takerFee,
            fill: {
                source: ERC20BridgeSource.Native,
                totalMakerAssetAmount: order.makerAssetAmount,
                totalTakerAssetAmount: order.takerAssetAmount,
                subFills: [],
            },
        };
    }

    constructor(contractAddress: ContractAddresses) {
        this._contractAddress = contractAddress;
    }

    // Convert sell fills into orders.
    public createSellOrdersFromPath(
        orderDomain: OrderDomain,
        inputToken: string,
        outputToken: string,
        path: CollapsedFill[],
        bridgeSlippage: number,
        liquidityProviderAddress?: string,
    ): OptimizedMarketOrder[] {
        const orders: OptimizedMarketOrder[] = [];
        for (const fill of path) {
            if (fill.source === ERC20BridgeSource.Native) {
                orders.push(createNativeOrder(fill));
            } else {
                orders.push(
                    createBridgeOrder(
                        orderDomain,
                        fill,
                        this._getBridgeAddressFromSource(fill.source, liquidityProviderAddress),
                        outputToken,
                        inputToken,
                        bridgeSlippage,
                    ),
                );
            }
        }
        return orders;
    }

    // Convert buy fills into orders.
    public createBuyOrdersFromPath(
        orderDomain: OrderDomain,
        inputToken: string,
        outputToken: string,
        path: CollapsedFill[],
        bridgeSlippage: number,
        liquidityProviderAddress?: string,
    ): OptimizedMarketOrder[] {
        const orders: OptimizedMarketOrder[] = [];
        for (const fill of path) {
            if (fill.source === ERC20BridgeSource.Native) {
                orders.push(createNativeOrder(fill));
            } else {
                orders.push(
                    createBridgeOrder(
                        orderDomain,
                        fill,
                        this._getBridgeAddressFromSource(fill.source, liquidityProviderAddress),
                        inputToken,
                        outputToken,
                        bridgeSlippage,
                        true,
                    ),
                );
            }
        }
        return orders;
    }

    private _getBridgeAddressFromSource(source: ERC20BridgeSource, liquidityProviderAddress?: string): string {
        switch (source) {
            case ERC20BridgeSource.Eth2Dai:
                return this._contractAddress.eth2DaiBridge;
            case ERC20BridgeSource.Kyber:
                return this._contractAddress.kyberBridge;
            case ERC20BridgeSource.Uniswap:
                return this._contractAddress.uniswapBridge;
            case ERC20BridgeSource.CurveUsdcDai:
            case ERC20BridgeSource.CurveUsdcDaiUsdt:
            case ERC20BridgeSource.CurveUsdcDaiUsdtTusd:
            case ERC20BridgeSource.CurveUsdcDaiUsdtBusd:
                return this._contractAddress.curveBridge;
            case ERC20BridgeSource.LiquidityProvider:
                if (liquidityProviderAddress === undefined) {
                    throw new Error(
                        'Cannot create a LiquidityProvider order without a LiquidityProvider pool address.',
                    );
                }
                assert.isETHAddressHex('liquidityProviderAddress', liquidityProviderAddress);
                return liquidityProviderAddress;
            default:
                break;
        }
        throw new Error(AggregationError.NoBridgeForSource);
    }
}

function createBridgeOrder(
    orderDomain: OrderDomain,
    fill: CollapsedFill,
    bridgeAddress: string,
    makerToken: string,
    takerToken: string,
    slippage: number,
    isBuy: boolean = false,
): OptimizedMarketOrder {
    let makerAssetData;
    if (Object.keys(constants.DEFAULT_CURVE_OPTS).includes(fill.source)) {
        const { curveAddress, tokens, version } = constants.DEFAULT_CURVE_OPTS[fill.source];
        const fromTokenIdx = tokens.indexOf(takerToken);
        const toTokenIdx = tokens.indexOf(makerToken);
        makerAssetData = assetDataUtils.encodeERC20BridgeAssetData(
            makerToken,
            bridgeAddress,
            createCurveBridgeData(curveAddress, fromTokenIdx, toTokenIdx, version),
        );
    } else {
        makerAssetData = assetDataUtils.encodeERC20BridgeAssetData(
            makerToken,
            bridgeAddress,
            createBridgeData(takerToken),
        );
    }
    return {
        makerAddress: bridgeAddress,
        makerAssetData,
        takerAssetData: assetDataUtils.encodeERC20AssetData(takerToken),
        ...createCommonOrderFields(orderDomain, fill, slippage, isBuy),
    };
}

function createBridgeData(tokenAddress: string): string {
    const encoder = AbiEncoder.create([{ name: 'tokenAddress', type: 'address' }]);
    return encoder.encode({ tokenAddress });
}

function createCurveBridgeData(
    curveAddress: string,
    fromTokenIdx: number,
    toTokenIdx: number,
    version: number,
): string {
    const curveBridgeDataEncoder = AbiEncoder.create([
        { name: 'curveAddress', type: 'address' },
        { name: 'fromTokenIdx', type: 'int128' },
        { name: 'toTokenIdx', type: 'int128' },
        { name: 'version', type: 'int128' },
    ]);
    return curveBridgeDataEncoder.encode([curveAddress, fromTokenIdx, toTokenIdx, version]);
}

type CommonOrderFields = Pick<
    OptimizedMarketOrder,
    Exclude<keyof OptimizedMarketOrder, 'makerAddress' | 'makerAssetData' | 'takerAssetData'>
>;

function createCommonOrderFields(
    orderDomain: OrderDomain,
    fill: CollapsedFill,
    slippage: number,
    isBuy: boolean = false,
): CommonOrderFields {
    const makerAssetAmountAdjustedWithSlippage = isBuy
        ? fill.totalMakerAssetAmount
        : fill.totalMakerAssetAmount.times(1 - slippage).integerValue(BigNumber.ROUND_DOWN);
    const takerAssetAmountAdjustedWithSlippage = isBuy
        ? fill.totalTakerAssetAmount.times(slippage + 1).integerValue(BigNumber.ROUND_UP)
        : fill.totalTakerAssetAmount;
    return {
        fill,
        takerAddress: NULL_ADDRESS,
        senderAddress: NULL_ADDRESS,
        feeRecipientAddress: NULL_ADDRESS,
        salt: generatePseudoRandomSalt(),
        expirationTimeSeconds: INFINITE_TIMESTAMP_SEC,
        makerFeeAssetData: NULL_BYTES,
        takerFeeAssetData: NULL_BYTES,
        makerFee: ZERO_AMOUNT,
        takerFee: ZERO_AMOUNT,
        makerAssetAmount: makerAssetAmountAdjustedWithSlippage,
        fillableMakerAssetAmount: makerAssetAmountAdjustedWithSlippage,
        takerAssetAmount: takerAssetAmountAdjustedWithSlippage,
        fillableTakerAssetAmount: takerAssetAmountAdjustedWithSlippage,
        fillableTakerFeeAmount: ZERO_AMOUNT,
        signature: WALLET_SIGNATURE,
        ...orderDomain,
    };
}

function createNativeOrder(fill: CollapsedFill): OptimizedMarketOrder {
    return {
        fill: {
            source: fill.source,
            totalMakerAssetAmount: fill.totalMakerAssetAmount,
            totalTakerAssetAmount: fill.totalTakerAssetAmount,
            subFills: fill.subFills,
        },
        ...(fill as NativeCollapsedFill).nativeOrder,
    };
}