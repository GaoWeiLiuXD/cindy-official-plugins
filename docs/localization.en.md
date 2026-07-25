<p align="right">
  <a href="localization.md">简体中文</a> · <strong>English</strong>
</p>

# Official Plugin Localization Contract

## The host is the single source of language

Plugin language strictly follows the Cindy host's current language. Plugins
must not read `navigator.language` or the operating system language, and must
not store an independent language preference.

The host currently supports:

- `zh-CN`
- `en`
- `ja`
- `ko`

When the plugin does not provide the host's current language, English is used;
when the host passes an unknown language, English is used as well. English is
not a configurable option — it is the protocol-level fallback.

## Manifest resources

Every official plugin declares four languages in `ghost.json`:

```json
{
  "locales": {
    "en": "locales/en.json",
    "zh-CN": "locales/zh-CN.json",
    "ja": "locales/ja.json",
    "ko": "locales/ko.json"
  }
}
```

A locale file fully covers the following fields:

```json
{
  "name": "Plugin name",
  "description": "Description shown to the user.",
  "whenToUse": "Routing description shown to the Agent.",
  "tools": {
    "stable_tool_name": {
      "description": "Localized tool contract."
    }
  }
}
```

Plugin ids, commands, tool names, parameter names, enum values, and error codes
are stable protocol and are never translated. Tool translations are keyed by
the stable tool name, not by array order.

## Host behavior

The Cindy client is responsible for:

1. Validating that `locales` contains only the four supported languages and
   that `en` is present.
2. Validating at Forge packaging time and at install time that the resource
   files exist, are valid JSON, are no larger than 64KB each, and fully cover
   the manifest's existing fields and all tools.
3. Resolving the plugin list, details, install confirmation, and the Agent tool
   catalog using the host's current language.
4. Falling back to the English resources when the plugin lacks the target
   language, the host language is unsupported, or the installed target
   resource is corrupted.
5. Re-broadcasting the localized plugin catalog after an in-app language
   switch, and reloading any open plugin settings pages and panels.
6. Returning, via `cindy.request({ kind: 'app-context' })` and the same-origin
   `GET /app-context`:

```json
{
  "ok": true,
  "context": {
    "region": "cn",
    "locale": "zh-CN"
  }
}
```

Running logic pages also receive the `host-context-changed` message. When a
plugin's self-rendered pages or runtime copy need to switch dynamically, read
only this `locale`, and fall back to the English resources when the plugin
itself does not support it.

## Repository gate

Before publishing, confirm:

- All 11 official plugins declare `zh-CN / en / ja / ko`.
- The fields and tool keys of the four resources are exactly consistent, with
  no empty values or placeholder copy.
- HTML/JS does not use `navigator.language`.
- Localization content changes bump `ghost.json.version` in the same change.
- The Mermaid icon continues to be served from the local Components directory,
  compressed within the host's size limit.
