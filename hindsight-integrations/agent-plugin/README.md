# Hindsight — Agent Plugin

A portable [Agent Plugin](https://agent-plugins.org) (spec `1.0.0`) that gives any
compatible agent client long-term memory via [Hindsight](https://hindsight.vectorize.io).

Agent Plugins is the vendor-neutral standard (AWS, Cursor, GitHub/Microsoft, OpenAI,
Vercel) for packaging **Agent Skills + MCP servers** into one plugin.
Multiple clients support this standard: **ChatGPT/Codex, Cursor, GitHub Copilot, Kiro, and VS Code**.

> **Codex users:** Codex's Agent Plugins loader drops this plugin's `Authorization`
> header, so it cannot authenticate. Use the Coding Agents integration instead. See
> [Codex](#codex) below.

This is the *portable* front door to Hindsight: one artifact, every supported client. It
carries the same `retain` / `recall` / `reflect` memory as our per-IDE integrations, but
as a single standards-based bundle instead of separate configs.

## What is in the bundle

```
agent-plugin/
├── plugin.json                       # manifest ($schema + name + metadata)
├── mcp.json                          # Hindsight MCP server (Streamable HTTP)
└── skills/
    └── hindsight-memory/
        └── SKILL.md                  # teaches the agent when to recall/retain/reflect
```

- **`mcp.json`** points the client at Hindsight's built-in MCP server (retain, recall,
  reflect, knowledge pages, and more — see [MCP Server docs](https://hindsight.vectorize.io/developer/mcp-server)).
  The plugin is transport-only. All memory logic stays server-side.
- **`skills/hindsight-memory/SKILL.md`** is in the agent context so it knows
  when to reach for memory, not just that the tools exist.

## Configuration

The plugin reads two environment variables (the client interpolates them into `mcp.json`):

| Variable | Needed | Purpose |
|----------|--------|---------|
| `HINDSIGHT_API_KEY` | yes (Cloud) | Your `hsk_...` key from [ui.hindsight.vectorize.io/connect](https://ui.hindsight.vectorize.io/connect). Sent as `Authorization: Bearer`. |
| `HINDSIGHT_BANK_ID` | no | Memory bank to scope to (sent as `X-Bank-Id`). Use one bank per user/project/team. |

**Self-hosting:** replace the host in `mcp.json` (`https://api.hindsight.vectorize.io`)
with your deployment URL. A local server with the MCP endpoint open needs no API key.

> Env-var interpolation syntax varies by client. Most use `${VAR}`. Some (VS Code,
> Cursor) prefer `${env:VAR}`. If your client does not substitute, paste the literal key
> and bank id into `mcp.json` instead. This does not work in Codex, which removes the
> `Authorization` header regardless of its value (see [Codex](#codex)).

**Bank selection when `HINDSIGHT_BANK_ID` is unset.** A client that substitutes variables
sends an empty `X-Bank-Id`, and the server uses the `default` bank. A client that does
not substitute sends the literal text `${HINDSIGHT_BANK_ID}`. Hindsight treats this text
as a bank name. Reads fail with bank-not-found, and the first `retain` creates a bank
with that name. Set the variable, or paste the bank id literally, to avoid this.

## Install

Installation and distribution are left to each client by the spec. Common paths:

- **VS Code / GitHub Copilot / Cursor / Kiro** — add this plugin directory through the
  plugin/MCP UI, or drop it where the client discovers plugins, then set the
  two environment variables above.
- **Codex** — not supported by this plugin. See [Codex](#codex) below.
- **ChatGPT** — register the plugin per the client's Agent Plugins support.

Ask the agent something that depends on past context after you install the plugin.
The agent calls `recall` or `retain` automatically, guided by the skill.

## Codex

Codex's Agent Plugins loader treats `Authorization` as a header only the client can set.
It removes the header in this plugin's `mcp.json`. It also copies the other headers verbatim, without
expanding `${VAR}` placeholders. So the portable plugin cannot authenticate to Hindsight
Cloud from Codex. Pasting a literal key into `mcp.json` does not help because Codex
removes the header.

For Codex, use the [Coding Agents](../coding-agents) integration instead. It writes Codex's native
MCP configuration and adds the automatic recall/retain hooks:

```bash
npx @vectorize-io/hindsight-coding-agents install codex
```

## Want automatic capture (hooks)?

Agent Plugins `1.0.0` standardizes **Skills + MCP**, not session lifecycle hooks. This
plugin delivers **explicit, tool-driven** memory that works identically
everywhere. For the automatic experience, use the hook-based [Coding Agents](../coding-agents) integration.
It injects recall before each prompt and retains transcripts on session exit.
It covers Claude Code, Codex, and other coding agents. The two share the
same banks, so memory that one integration captures, the other integration recalls.

## Validate the manifests

```bash
python3 hindsight-integrations/agent-plugin/validate.py
```

Checks that `plugin.json` and `mcp.json` parse and satisfy the Agent Plugins `1.0.0`
contract.
