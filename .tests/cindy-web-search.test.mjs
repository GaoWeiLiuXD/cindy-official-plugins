import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'cindy-web-search');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

function createHarness(options = {}) {
  const kv = options.kv ?? {};
  const networkCalls = [];
  const cindyRequests = [];
  const toolResults = [];
  let handler = null;

  const cindy = {
    onHostMessage(fn) {
      handler = fn;
    },
    async fetch(request) {
      networkCalls.push(request);
      if (options.networkResult) return options.networkResult(request);
      throw new Error('unexpected network request');
    },
    async send(message) {
      if (message.type === 'cindy-request') {
        cindyRequests.push(message);
        return options.cindyResult ?? {
          ok: true,
          provider: 'cindy',
          results: [
            {
              title: 'Cindy',
              url: 'https://example.test/cindy',
              snippet: 'Managed result',
            },
          ],
        };
      }
      if (message.type === 'tool-result') {
        toolResults.push(message);
        return { ok: true };
      }
      throw new Error(`unexpected cindy.send type ${message.type}`);
    },
  };

  vm.runInNewContext(source, {
    cindy,
    fetch: async (url) => {
      assert.equal(url, '/kv');
      return {
        ok: true,
        async json() {
          return kv;
        },
      };
    },
    encodeURIComponent,
    isFinite,
    JSON,
    String,
    Error,
  });
  assert.equal(typeof handler, 'function');

  return {
    networkCalls,
    cindyRequests,
    toolResults,
    async search(args = {}) {
      await handler({
        type: 'tool-call',
        tool: 'search_web',
        callId: 'call-1',
        args: { query: 'Cindy', ...args },
      });
      return toolResults.at(-1);
    },
  };
}

test('manifest declares Cindy Web Search and keeps BYO providers explicit', () => {
  assert.equal(manifest.version, '1.3.0');
  assert.deepEqual(manifest.cindy, { search: ['web'] });
  assert.ok(manifest.slots.includes('cindy'));
  assert.deepEqual(manifest.setup, { requires: [] });
  const provider = manifest.tools[0].parameters.properties.provider;
  assert.deepEqual(provider.enum, ['cindy', 'brave', 'tavily']);
  assert.equal(provider.enum.includes('auto'), false);
});

test('missing provider uses Cindy AI by default and does not touch BYO network', async () => {
  const harness = createHarness();
  const result = await harness.search();

  assert.equal(harness.networkCalls.length, 0);
  assert.equal(harness.cindyRequests.length, 1);
  const request = harness.cindyRequests[0];
  assert.equal(request.type, 'cindy-request');
  assert.equal(request.kind, 'search_web');
  assert.equal(request.query, 'Cindy');
  assert.equal(request.limit, 5);
  assert.equal(request.provider, 'cindy');
  assert.equal(request.callId, 'call-1');
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'cindy');
});

test('disabled Cindy AI uses the configured BYO default only', async () => {
  const harness = createHarness({
    kv: { cindyAiEnabled: false, byoDefaultProvider: 'tavily' },
    networkResult(request) {
      assert.equal(request.url, 'https://api.tavily.com/search');
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          results: [
            {
              title: 'Tavily',
              url: 'https://example.test/tavily',
              content: 'BYO result',
            },
          ],
        }),
      };
    },
  });
  const result = await harness.search();

  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(harness.networkCalls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'tavily');
});

test('explicit provider wins over settings and provider failures never fall back', async () => {
  const brave = createHarness({
    networkResult(request) {
      assert.match(request.url, /^https:\/\/api\.search\.brave\.com\//);
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          web: {
            results: [
              {
                title: 'Brave',
                url: 'https://example.test/brave',
                description: 'BYO result',
              },
            ],
          },
        }),
      };
    },
  });
  const braveResult = await brave.search({ provider: 'brave' });
  assert.equal(brave.cindyRequests.length, 0);
  assert.equal(brave.networkCalls.length, 1);
  assert.equal(braveResult.result.provider, 'brave');

  const failedCindy = createHarness({
    cindyResult: {
      ok: false,
      errorCode: 'QUOTA_EXHAUSTED',
      message: 'Cindy AI quota exhausted',
    },
  });
  const failedResult = await failedCindy.search({ provider: 'cindy' });
  assert.equal(failedCindy.cindyRequests.length, 1);
  assert.equal(failedCindy.networkCalls.length, 0);
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.message, 'Cindy AI quota exhausted');
});
