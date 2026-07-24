import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const locales = ['zh-CN', 'en', 'ja', 'ko'];
const pluginDirs = fs.readdirSync(root)
  .filter((name) => fs.existsSync(path.join(root, name, 'ghost.json')))
  .sort();

test('all official plugins provide complete host-driven locale resources', () => {
  assert.equal(pluginDirs.length, 11);
  for (const pluginDir of pluginDirs) {
    const manifestPath = path.join(root, pluginDir, 'ghost.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(Object.keys(manifest.locales ?? {}).sort(), [...locales].sort(), pluginDir);
    const expectedTools = (manifest.tools ?? []).map((tool) => tool.name).sort();

    for (const locale of locales) {
      const localePath = path.join(root, pluginDir, manifest.locales[locale]);
      assert.ok(fs.statSync(localePath).size <= 64 * 1024, `${pluginDir}/${locale} is too large`);
      const resource = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      for (const key of ['name', 'description', 'whenToUse']) {
        assert.equal(typeof resource[key], 'string', `${pluginDir}/${locale}.${key}`);
        assert.ok(resource[key].trim(), `${pluginDir}/${locale}.${key} is empty`);
      }
      assert.deepEqual(
        Object.keys(resource.tools ?? {}).sort(),
        expectedTools,
        `${pluginDir}/${locale} tool keys`,
      );
      for (const toolName of expectedTools) {
        assert.ok(
          resource.tools[toolName].description.trim(),
          `${pluginDir}/${locale}.tools.${toolName}.description`,
        );
      }
    }
  }
});

test('plugins never infer language from the browser or operating system', () => {
  for (const pluginDir of pluginDirs) {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.endsWith('.cindy')) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (/\.(?:html|js|cjs|mjs)$/.test(entry.name)) files.push(absolute);
      }
    };
    walk(path.join(root, pluginDir));
    for (const file of files) {
      assert.doesNotMatch(
        fs.readFileSync(file, 'utf8'),
        /\bnavigator\.(?:language|languages)\b/,
        path.relative(root, file),
      );
    }
  }
});
