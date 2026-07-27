# @taptap/maker

TapTap Maker local development CLI and MCP server.

## Usage

```bash
npx -y @taptap/maker init
```

Common commands:

```bash
taptap-maker init
taptap-maker doctor
taptap-maker apps --json
taptap-maker pat set
taptap-maker install --ide codex,cursor,claude
taptap-maker mcp verify
taptap-maker agents update
taptap-maker upgrade
taptap-maker dev-kit update
```

`taptap-maker install` is a shortcut alias for `taptap-maker mcp install`.
`taptap-maker upgrade` refreshes the current machine MCP config and the current bound project's
managed `AGENTS.md` policy block.

This package contains only the Maker CLI/MCP bundle and Maker workflow skills.
It does not include the legacy TapTap Open API MCP server, proxy, native signer,
or OpenClaw plugin package contents.

Full connection and tool-call troubleshooting guide: `docs/MAKER_MCP_CONNECTION_TROUBLESHOOTING.md`.

Version: 0.0.27
