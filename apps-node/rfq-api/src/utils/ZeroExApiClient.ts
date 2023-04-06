import { BigNumber } from '@0x/utils';
import { AxiosInstance } from 'axios';
import { Summary } from 'prom-client';

import { ChainConfiguration } from '../config';
import { logger } from '../logger';
import { QuoteContext } from '../services/types';

/**
 * With this summary metric, some of the things you can do are:
 * - Get the rate of failed requests
 * - Get the rate of success requests
 * - Get the p99 of request duration of success/failed requests (with the sliding window of 1 minute)
 */
const RFQ_AMM_QUOTE_FETCH_REQUEST_DURATION_SECONDS = new Summary({
    name: 'rfq_amm_quote_fetch_request_duration_seconds',
    help: 'Histogram of request duration of AMM Quote fetch request',
    percentiles: [0.5, 0.9, 0.95, 0.99, 0.999],
    labelNames: ['chainId', 'success', 'errorType'],
    // Set sliding window to 1 minutes
    maxAgeSeconds: 60,
    // The more number of age buckets, the smoother the time window is moved
    // but it also consumes more memory & CPU for maintaining the bucket.
    ageBuckets: 5,
});

enum FailedFetchErrorType {
    InvalidBody = 'invalid_body',
    Other = 'other',
}

export interface AmmQuote {
    makerAmount: BigNumber;
    takerAmount: BigNumber;
    expectedSlippage: BigNumber;
    estimatedGasFeeWei: BigNumber;
    decodedUniqueId?: string;
}

interface ZeroExApiGetQuoteResponse {
    buyAmount: string;
    sellAmount: string;
    estimatedGas: string;
    gasPrice: string;
    expectedSlippage: string;
    decodedUniqueId?: string;
}

export class ZeroExApiClient {
    public constructor(
        private readonly _axiosInstance: AxiosInstance,
        private readonly _zeroExApiKey: string,
        private readonly _chainConfiguration: Pick<ChainConfiguration, 'chainId' | 'zeroExClientBaseUrl'>,
    ) {}

    /**
     * Fetch AMM Quote from 0x API. The quoteContext provided in the params will be transformed to match with 0x API definition:
     * - takerAmount -> sellAmount
     * - makerAmount -> buyAmount
     *
     * The response from 0x API will also be transformed (in reverse) to match with AmmQuote interface.
     *
     * @returns a promise resolved to AMM Quote if the fetch was successful. Otherwise, returns a promise resolved to null.
     */
    public async fetchAmmQuoteAsync(
        quoteContext: Pick<
            QuoteContext,
            'takerAmount' | 'makerAmount' | 'takerToken' | 'makerToken' | 'takerAddress' | 'affiliateAddress'
        >,
    ): Promise<AmmQuote | null> {
        const stopTimer = RFQ_AMM_QUOTE_FETCH_REQUEST_DURATION_SECONDS.startTimer({
            chainId: this._chainConfiguration.chainId.toString(),
        });

        // Transform QuoteContext to 0xAPI Get Quote Params
        const zeroExApiGetQuoteParams: {
            buyAmount?: string;
            buyToken: string;
            sellAmount?: string;
            sellToken: string;
            takerAddress?: string;
            affiliateAddress?: string;
            excludedSources: string;
        } = {
            buyAmount: quoteContext.makerAmount?.toString(),
            buyToken: quoteContext.makerToken,
            sellAmount: quoteContext.takerAmount?.toString(),
            sellToken: quoteContext.takerToken,
            takerAddress: quoteContext.takerAddress,
            affiliateAddress: quoteContext.affiliateAddress,
            excludedSources: '0x', // Exclude 0x source to get quote from AMM only
        };

        try {
            const { data }: { data: ZeroExApiGetQuoteResponse } = await this._axiosInstance.get('/swap/v1/quote', {
                baseURL: this._chainConfiguration.zeroExClientBaseUrl,
                params: zeroExApiGetQuoteParams,
                headers: {
                    '0x-api-key': this._zeroExApiKey,
                },
            });

            // Parsing and validating 0xAPI response
            const makerAmount = new BigNumber(data.buyAmount);
            const takerAmount = new BigNumber(data.sellAmount);
            const estimatedGas = new BigNumber(data.estimatedGas);
            const gasPrice = new BigNumber(data.gasPrice);
            const expectedSlippage = new BigNumber(data.expectedSlippage !== null ? data.expectedSlippage : 0);
            const { decodedUniqueId } = data;
            if (
                makerAmount.isNaN() ||
                takerAmount.isNaN() ||
                estimatedGas.isNaN() ||
                gasPrice.isNaN() ||
                expectedSlippage.isNaN()
            ) {
                throw new Error(`Unexpected body returned from 0xAPI: ${JSON.stringify(data)}`);
            }
            if (!decodedUniqueId) {
                logger.warn(`Missing decodedUniqueId from 0xAPI`);
            }

            // Mapping 0x API's response to AmmQuote
            const ammQuote: AmmQuote = {
                makerAmount,
                takerAmount,
                estimatedGasFeeWei: estimatedGas.times(gasPrice),
                expectedSlippage,
                decodedUniqueId,
            };

            stopTimer({ success: 'true' });
            return ammQuote;
        } catch (error) {
            if (error.message.includes('Unexpected body returned from 0xAPI')) {
                stopTimer({ success: 'false', errorType: FailedFetchErrorType.InvalidBody });
            } else {
                stopTimer({ success: 'false', errorType: FailedFetchErrorType.Other });
            }
            logger.error(
                {
                    chainId: this._chainConfiguration.chainId,
                    zeroExApiGetQuoteParams,
                    message: error.message,
                    body: error.response?.data || null,
                },
                'Failed to fetch AMM Quote from 0x API',
            );
            return null;
        }
    }
}