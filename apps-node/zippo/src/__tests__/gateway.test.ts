import { kongMock } from './mocks/kongMock';

import { provisionIntegratorAccess } from '../gateway';
import { TZippoRouteTag } from 'zippo-interface';

describe('gateway tests', () => {
    test('provision integrator', async () => {
        // set up mocks
        kongMock.kongEnsureConsumer.mockResolvedValue({
            id: '156f70c1-e993-4293-a4a4-528190f2b46c',
            created_at: 12345,
            username: 'app12345',
        });
        kongMock.kongEnsureZeroexHeaders.mockResolvedValue(true);
        kongMock.kongEnsureAcl.mockResolvedValue({
            id: '256f70c1-e993-4293-a4a4-528190f2b46c',
            consumer: { id: '356f70c1-e993-4293-a4a4-528190f2b46c' },
            created_at: 12345,
            group: 'swap_v1_price_group',
        });
        kongMock.kongEnsureRateLimit.mockResolvedValue({
            id: '456f70c1-e993-4293-a4a4-528190f2b46c',
            consumer: { id: '556f70c1-e993-4293-a4a4-528190f2b46c' },
            created_at: 12345,
            name: 'rate-limit',
            enabled: true,
            config: {
                minute: 30,
            },
        });

        // should provision integrator access
        await expect(
            provisionIntegratorAccess('integrator12345', 'app12345', [TZippoRouteTag.SwapV1Prices], [{ minute: 30 }]),
        ).resolves.toBeTruthy();

        // should confirm mock calls, () => {
        expect(kongMock.kongEnsureConsumer.mock.calls[0][0]).toEqual('app12345');
        expect(kongMock.kongEnsureZeroexHeaders.mock.calls[0][0]).toEqual('app12345');
        expect(kongMock.kongEnsureZeroexHeaders.mock.calls[0][1]).toEqual('integrator12345');
        expect(kongMock.kongEnsureAcl.mock.calls[0][0]).toEqual('app12345');
        expect(kongMock.kongEnsureAcl.mock.calls[0][1]).toEqual('swap_v1_prices_group');
        expect(kongMock.kongEnsureRateLimit.mock.calls[0][0]).toEqual('app12345');
        expect(kongMock.kongEnsureRateLimit.mock.calls[0][1]).toEqual('swap_v1_prices_route_optimism');
        expect(kongMock.kongEnsureRateLimit.mock.calls[0][2]).toEqual({
            minute: 30,
        });
        expect(kongMock.kongEnsureRateLimit.mock.calls[1][1]).toEqual('swap_v1_prices_route_fantom');
        expect(kongMock.kongEnsureRateLimit.mock.calls[1][2]).toEqual({
            minute: 30,
        });
    });
});
