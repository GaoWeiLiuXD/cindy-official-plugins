import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'world-bank-open-data');

const loadPlugin = () => {
  globalThis.cindy = {
    onHostMessage() {},
    fetch: async () => ({ ok: true, status: 200, body: '[{},[]]' }),
    send: async () => ({ ok: true }),
  };
  const resolved = require.resolve('../world-bank-open-data/main.js');
  delete require.cache[resolved];
  return require(resolved);
};

test('manifest declares one public API host and no credential surface', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
  assert.deepEqual(manifest.network.hosts, ['api.worldbank.org']);
  assert.equal(manifest.network.secrets, undefined);
  assert.equal(manifest.network.connections, undefined);
  assert.equal(manifest.settingsHtml, undefined);
  assert.deepEqual(manifest.slots, ['tool', 'network']);
});

test('common aliases resolve to documented World Bank indicator codes', () => {
  const plugin = loadPlugin();
  assert.equal(plugin.resolveIndicator('gdp').code, 'NY.GDP.MKTP.CD');
  assert.equal(plugin.resolveIndicator('GDP growth').code, 'NY.GDP.MKTP.KD.ZG');
  assert.equal(plugin.resolveIndicator('SP.POP.TOTL').code, 'SP.POP.TOTL');
  assert.match(plugin.resolveIndicator('not valid / code').err, /不是合法/);
});

test('country code and year inputs are bounded', () => {
  const plugin = loadPlugin();
  assert.deepEqual(plugin.normalizeCodes(['chn', 'USA', 'CHN'], 'countries', 25), {
    values: ['CHN', 'USA'],
  });
  assert.match(plugin.normalizeCodes(['CN/US'], 'countries', 25).err, /非法代码/);
  assert.deepEqual(plugin.validateYearRange({ startYear: 2020, endYear: 2024 }), {
    start: 2020,
    end: 2024,
  });
  assert.match(plugin.validateYearRange({ startYear: 2020 }).err, /必须一起传/);
});

test('World Bank two-element responses and API errors are classified', () => {
  const plugin = loadPlugin();
  assert.deepEqual(
    plugin.parseWorldBankResponse('[{"page":1},[{"id":"CHN"}]]'),
    { meta: { page: 1 }, rows: [{ id: 'CHN' }] },
  );
  assert.match(
    plugin.parseWorldBankResponse('[{"message":[{"value":"Invalid value"}]}]').err,
    /Invalid value/,
  );
  assert.match(plugin.parseWorldBankResponse('not-json').err, /不是合法 JSON/);
  assert.match(plugin.classifyStatus(404), /没有找到/);
  assert.match(plugin.classifyStatus(429), /频繁/);
});

test('runtime source remains read-only and contains no secret storage endpoints', () => {
  const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');
  assert.doesNotMatch(source, /\/secrets|\/connections|method:\s*['"]POST['"]/);
  assert.match(source, /api\.worldbank\.org/);
});
