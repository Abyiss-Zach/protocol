import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLastLookRejectionsEthereumView1657828017000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // TypeORM does not have a 'nice' way to create VIEWs, so we have to use a regular SQL Query
        await queryRunner.query(`
          CREATE VIEW public.fast_last_look_rejections_ethereum AS (
              SELECT
                  jobs.order_hash AS "orderHash",
                  quotes.created_at AS "quoteIssuedAt",
                  extract(epoch from jobs.created_at - quotes.created_at) AS "quoteOutstandingSeconds",
                  CASE
                      WHEN (taker_token = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') THEN (taker_amount / 1e18)
                      WHEN (maker_token = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') THEN (maker_amount / 1e18)
                      ELSE null
                  END AS "volumeETH",
                  CASE
                      -- DAI
                      WHEN (taker_token = '0x6b175474e89094c44da98b954eedeac495271d0f') THEN (taker_amount / 1e18)
                      WHEN (maker_token = '0x6b175474e89094c44da98b954eedeac495271d0f') THEN (maker_amount / 1e18)
                      -- USDC
                      WHEN (taker_token = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') THEN (taker_amount / 1e6)
                      WHEN (maker_token = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') THEN (maker_amount / 1e6)
                      -- USDT
                      WHEN (taker_token = '0xdac17f958d2ee523a2206206994597c13d831ec7') THEN (taker_amount / 1e6)
                      WHEN (maker_token = '0xdac17f958d2ee523a2206206994597c13d831ec7') THEN (maker_amount / 1e6)
                      ELSE null
                  END AS "volumeUSD",
                  taker as "takerAddress",
                  taker_token AS "takerToken",
                  taker_amount AS "takerAmount",
                  maker_token AS "makerToken",
                  maker_amount AS "makerAmount",
                  ll_reject_price_difference_bps AS "priceDifferenceBPS",
                  maker_uri AS "makerURI"
              FROM (
                  SELECT
                      order_hash,
                      created_at,
                      -- v2.order
                      "order"#>>'{order,takerToken}' AS taker_token,
                      "order"#>>'{order,makerToken}' AS maker_token,
                      ("order"#>>'{order,takerAmount}')::NUMERIC AS taker_amount,
                      ("order"#>>'{order,makerAmount}')::NUMERIC AS maker_amount,
                      "order"#>>'{order,taker}' AS taker,
                      ll_reject_price_difference_bps
                  FROM public.rfqm_v2_jobs v2
                  WHERE
                      status='failed_last_look_declined' AND
                      chain_id = 1
              ) jobs
              LEFT JOIN (
                  SELECT
                      order_hash,
                      created_at,
                      maker_uri,
                      chain_id
                  FROM public.rfqm_v2_quotes
              ) quotes ON jobs.order_hash = quotes.order_hash
              WHERE chain_id = 1
              ORDER BY quotes.created_at DESC
          );
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
          DROP VIEW public.fast_last_look_rejections_ethereum;
        `);
    }
}