import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const plugins = [
  'google-calendar',
  'google-drive',
  'google-gmail',
  'google-sheets',
] as const;

function readPluginFile(plugin: string, filename: string) {
  return readFileSync(new URL(`../${plugin}/${filename}`, import.meta.url), 'utf8');
}

function oauthConfig(plugin: string) {
  const manifest = JSON.parse(readPluginFile(plugin, 'ghost.json')) as {
    network: {
      secrets: Array<{
        source?: string;
        oauth?: { clientId?: string; clientSecret?: string };
      }>;
    };
  };
  return manifest.network.secrets.find((secret) => secret.source === 'oauth')?.oauth;
}

function formatConnectError(plugin: string, error: string, detail: string) {
  const source = readPluginFile(plugin, 'settings.js');
  const match = source.match(
    /function connectError\(result\) \{([\s\S]*?)\n  \}\n  function render/,
  );
  if (!match) throw new Error(`${plugin} does not declare connectError`);

  const context = createContext({
    input: { error, detail },
    output: '',
    String,
  });
  new Script(
    `function connectError(result) {${match[1]}\n  }\noutput = connectError(input);`,
    { filename: `${plugin}/settings.js` },
  ).runInContext(context);
  return context.output as string;
}

describe('Google Workspace OAuth 配置', () => {
  it.each(plugins)('%s 内置 OAuth client 配置成对存在', (plugin) => {
    const oauth = oauthConfig(plugin);
    expect(oauth?.clientId).toBeTruthy();
    expect(oauth?.clientSecret).toBeTruthy();
  });

  it.each(plugins)('%s 设置页展示结构化错误及安全 detail', (plugin) => {
    const message = formatConnectError(plugin, 'EXCHANGE_FAILED', 'invalid_client');
    expect(message).toContain('Google token 交换失败');
    expect(message).toContain('invalid_client');
  });

  it.each(plugins)('%s 未知错误仍保留服务端 detail', (plugin) => {
    const message = formatConnectError(plugin, 'UNKNOWN', 'callback rejected');
    expect(message).toContain('连接失败，请重试');
    expect(message).toContain('callback rejected');
  });
});
