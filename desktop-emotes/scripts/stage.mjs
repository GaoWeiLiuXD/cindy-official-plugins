import { mkdirSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = resolve(root, 'build/package');
if (!existsSync(resolve(root, 'native/DesktopEmotes.app/Contents/MacOS/DesktopEmotes'))) throw new Error('Run the native build first.');
mkdirSync(target, { recursive: true });
for (const entry of ['ghost.json', 'main.js', 'shortcuts.js', 'wheel-layout.js', 'emote-library.js', 'settings.html', 'settings.js', 'settings.css', 'node', 'assets', 'locales']) {
  cpSync(resolve(root, entry), resolve(target, entry), { recursive: true });
}
mkdirSync(resolve(target, 'native'), { recursive: true });
cpSync(resolve(root, 'native/DesktopEmotes.app'), resolve(target, 'native/DesktopEmotes.app'), { recursive: true });
console.log(target);
