import { BigNumber } from '@0x/utils';
import { ZERO } from '../constants';
import {
    GasFee,
    GasFeeConfig,
    FeeConfigs,
    Fees,
    IntegratorShareFee,
    IntegratorShareFeeConfig,
    VolumeBasedFee,
    VolumeBasedFeeConfig,
} from '../types';

/**
 * `transferFrom` estimated gas:
 * - Decrease balance of the owner (SLOAD + SSTORE): 24,000
 * - Increase balance of the spender (SLOAD + SSTORE): 24,000
 * - Update allowance of the spender (SLOAD + SSTORE): 24,000
 */
const TRANSFER_FROM_GAS = new BigNumber(72e3);

/**
 * Calculate fees object which contains total fee amount and a breakdown of integrator, 0x and gas fees.
 *
 * @param feeConfigs Fee configs parsed from input.
 * @param opts sellToken: Address of the sell token.
 *             sellTokenAmount: Amount of the sell token.
 *             sellTokenAmountPerBaseUnitNativeToken: Amount of sell token per base unit native token.
 *             gasPrice: Estimated gas price.
 *             quoteGasEstimate: The gas estimate to fill the quote.
 * @returns Fee object and the total on-chain fee amount.
 */
export function calculateFees(opts: {
    feeConfigs: FeeConfigs;
    sellToken: string;
    sellTokenAmount: BigNumber;
    sellTokenAmountPerBaseUnitNativeToken: BigNumber;
    gasPrice: BigNumber;
    quoteGasEstimate: BigNumber;
}): { fees: Fees; totalOnChainChargedFeeAmount: BigNumber } {
    const integratorFee = _calculateIntegratorFee({
        integratorFeeConfig: opts.feeConfigs.integratorFee,
        sellToken: opts.sellToken,
        sellTokenAmount: opts.sellTokenAmount,
    });

    const zeroExFee = _calculateZeroExFee({
        zeroExFeeConfig: opts.feeConfigs.zeroExFee,
        sellToken: opts.sellToken,
        sellTokenAmount: opts.sellTokenAmount,
        integratorFee,
    });

    const gasFee = _calculateGasFee({
        gasFeeConfig: opts.feeConfigs.gasFee,
        sellToken: opts.sellToken,
        sellTokenAmountPerBaseUnitNativeToken: opts.sellTokenAmountPerBaseUnitNativeToken,
        gasPrice: opts.gasPrice,
        quoteGasEstimate: opts.quoteGasEstimate,
        integratorFee,
        zeroExFee,
    });

    const fees = {
        integratorFee,
        zeroExFee,
        gasFee,
    };

    return {
        fees,
        // `totalOnChainChargedFeeAmount` is used to adjust pricing. Currently, only on-chain fee would impact pricing.
        totalOnChainChargedFeeAmount: _calculateTotalOnChainChargedFeeAmount(fees),
    };
}

function _calculateTotalOnChainChargedFeeAmount(fees: Fees): BigNumber {
    let totalFeeAmount = ZERO;

    // Integrator fee
    if (fees.integratorFee && fees.integratorFee.billingType === 'on-chain' && fees.integratorFee.feeRecipient) {
        totalFeeAmount = totalFeeAmount.plus(fees.integratorFee.feeAmount);
    }
    // 0x fee
    if (fees.zeroExFee && fees.zeroExFee.billingType === 'on-chain' && fees.zeroExFee.feeRecipient) {
        // If the fee kind is integrator_share, the 0x amount has already been included in integrator amount
        if (fees.zeroExFee.type !== 'integrator_share') {
            totalFeeAmount = totalFeeAmount.plus(fees.zeroExFee.feeAmount);
        }
    }
    // Gas fee
    if (fees.gasFee && fees.gasFee.billingType === 'on-chain' && fees.gasFee.feeRecipient) {
        totalFeeAmount = totalFeeAmount.plus(fees.gasFee.feeAmount);
    }

    return totalFeeAmount;
}

function _calculateIntegratorFee(opts: {
    integratorFeeConfig?: VolumeBasedFeeConfig;
    sellToken: string;
    sellTokenAmount: BigNumber;
}): VolumeBasedFee | undefined {
    if (!opts.integratorFeeConfig) {
        return undefined;
    }

    return {
        type: 'volume',
        feeToken: opts.sellToken,
        feeAmount: opts.sellTokenAmount
            .times(opts.integratorFeeConfig.volumePercentage)
            .integerValue(BigNumber.ROUND_FLOOR),
        feeRecipient: opts.integratorFeeConfig.feeRecipient,
        billingType: opts.integratorFeeConfig.billingType,
        volumePercentage: opts.integratorFeeConfig.volumePercentage,
    };
}

function _calculateZeroExFee(opts: {
    zeroExFeeConfig?: VolumeBasedFeeConfig | IntegratorShareFeeConfig;
    sellToken: string;
    sellTokenAmount: BigNumber;
    integratorFee?: VolumeBasedFee;
}): VolumeBasedFee | IntegratorShareFee | undefined {
    if (!opts.zeroExFeeConfig) {
        return undefined;
    }

    switch (opts.zeroExFeeConfig.type) {
        case 'volume':
            return {
                type: 'volume',
                feeToken: opts.sellToken,
                feeAmount: opts.sellTokenAmount
                    .times(opts.zeroExFeeConfig.volumePercentage)
                    .integerValue(BigNumber.ROUND_FLOOR),
                feeRecipient: opts.zeroExFeeConfig.feeRecipient,
                billingType: opts.zeroExFeeConfig.billingType,
                volumePercentage: opts.zeroExFeeConfig.volumePercentage,
            };
        case 'integrator_share':
            if (!opts.integratorFee) {
                // This should never happen
                throw new Error('Integrator fee is undefined');
            }

            return {
                type: 'integrator_share',
                feeToken: opts.sellToken,
                feeAmount: opts.integratorFee.feeAmount
                    .times(opts.zeroExFeeConfig.integratorSharePercentage)
                    .integerValue(BigNumber.ROUND_FLOOR),
                feeRecipient: opts.zeroExFeeConfig.feeRecipient,
                billingType: opts.zeroExFeeConfig.billingType,
                integratorSharePercentage: opts.zeroExFeeConfig.integratorSharePercentage,
            };
        default:
            return undefined;
    }
}

function _calculateGasFee(opts: {
    gasFeeConfig?: GasFeeConfig;
    sellToken: string;
    sellTokenAmountPerBaseUnitNativeToken: BigNumber;
    gasPrice: BigNumber;
    quoteGasEstimate: BigNumber;
    integratorFee?: VolumeBasedFee;
    zeroExFee?: VolumeBasedFee | IntegratorShareFee;
}): GasFee | undefined {
    if (!opts.gasFeeConfig) {
        return undefined;
    }

    // Check the number of `transferFrom` necessary for fee
    const feeRecipients = new Set<string>();
    if (
        opts.integratorFee &&
        opts.integratorFee.billingType === 'on-chain' &&
        opts.integratorFee.feeRecipient &&
        opts.integratorFee.feeAmount.gt(0)
    ) {
        feeRecipients.add(opts.integratorFee.feeRecipient);
    }
    if (
        opts.zeroExFee &&
        opts.zeroExFee.billingType === 'on-chain' &&
        opts.zeroExFee.feeRecipient &&
        opts.zeroExFee.feeAmount.gt(0)
    ) {
        feeRecipients.add(opts.zeroExFee.feeRecipient);
    }
    if (opts.gasFeeConfig && opts.gasFeeConfig.billingType === 'on-chain' && opts.gasFeeConfig.feeRecipient) {
        feeRecipients.add(opts.gasFeeConfig.feeRecipient);
    }

    const numTransferFromForFee = feeRecipients.size;
    // Add the `transferFrom` gas to gas cost to fill the order
    const estimatedGas = opts.quoteGasEstimate.plus(TRANSFER_FROM_GAS.times(numTransferFromForFee));

    return {
        type: 'gas',
        feeToken: opts.sellToken,
        feeAmount: opts.sellTokenAmountPerBaseUnitNativeToken
            .times(opts.gasPrice)
            .times(estimatedGas)
            .integerValue(BigNumber.ROUND_FLOOR),
        feeRecipient: opts.gasFeeConfig.feeRecipient,
        billingType: opts.gasFeeConfig.billingType,
        feeTokenAmountPerBaseUnitNativeToken: opts.sellTokenAmountPerBaseUnitNativeToken,
        gasPrice: opts.gasPrice,
        estimatedGas,
    };
}
