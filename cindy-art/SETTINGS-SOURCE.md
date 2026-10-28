# Art settings source

The settings card follows `CindyCapabilityPrefs` with `appearance="plugin"` at Cindy commit `bc772d722d2992f36c4bf641996447f3e76aac68` (the parent of PR #6073's removal commit).

Source files from that revision:
- `apps/desktop/src/renderer/cindy-brain/CindyCapabilityPrefs.tsx`: card, four media rows, picker dimensions and selection states.
- `apps/desktop/src/renderer/components/new-chat/ModelSelector.tsx`: `ModelIconMark` and `ProviderMark`, including dense sizing and monochrome color.
- `apps/desktop/src/renderer/components/icons/XDIncMark.tsx`: all three original XD symbol paths and `136 137 282 158` viewBox.
- `apps/desktop/src/shared/brandMarkPaths.ts`: original OpenAI and Anthropic paths.
- `packages/model-providers/src/providerBranding.ts`: complete original provider paths and provider/routing lookup, transpiled without changing path data.
- `lucide-react@0.468.0`: original Sparkles, ChevronDown and Check nodes.

`settings-icons.js` contains those SVG data and provider lookup rules. It does not infer a provider logo from a model name or replace logos with stars/letters. Unknown providers only use the original bordered monogram when their display name is available.

Sandbox adaptations: external same-origin scripts (CSP disallows inline scripts), `/media-models` as the public catalog, and plugin-owned `/kv` for the four independent selections. The public catalog does not expose provider display names or routing; those optional properties cannot be reproduced for a renamed custom provider unless the host supplies them. Built-in provider ids resolve through the copied original mapping. The dropdown stays within the settings webview, rather than escaping into the host renderer's portal.

Original data SHA-256 (JSON serialization):
- XD path array: `1e4b09088de6f3da49e7f1c38ed29234bcc17f84443395f6b5079fc338048689`
- Provider path map: `e6ae671d34e930f4c22343e1280a44e921d357bb17ee8888e0225a810543a202`
- Lucide node map: `38c5f7e508eb29233a0a0740747e2f994db65fcf30256c63b60db8b9a3ae8a34`
