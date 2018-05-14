import * as chai from 'chai';
import * as _ from 'lodash';
import 'make-promises-safe';
import 'mocha';
import * as path from 'path';

import { ZeroExArtifactAdapter } from '../src/artifact_adapters/0x';

const expect = chai.expect;

describe('Collect contracts data', () => {
    describe('#collectContractsData', () => {
        it('correctly collects contracts data', async () => {
            const artifactsPath = path.resolve(__dirname, 'fixtures/artifacts');
            const sourcesPath = path.resolve(__dirname, 'fixtures/contracts');
            const zeroExArtifactsAdapter = new ZeroExArtifactAdapter(artifactsPath, sourcesPath);
            const contractsData = await zeroExArtifactsAdapter.collectContractsDataAsync();
            _.forEach(contractsData, contractData => {
                expect(contractData).to.have.keys([
                    'sourceCodes',
                    'sources',
                    'sourceMap',
                    'sourceMapRuntime',
                    'bytecode',
                    'runtimeBytecode',
                ]);
            });
        });
    });
});
