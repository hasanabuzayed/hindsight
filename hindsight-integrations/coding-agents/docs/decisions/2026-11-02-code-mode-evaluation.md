# ADR: Evaluation of Native Code Mode for Hindsight MCP

- **Status**: Decided
- **Date**: 2026-11-02
- **Decider**: Agents Platform Team
- **Initiative**: MER-401

## Context

Hindsight MCP provides 8 discrete tools for coding agents:
- `hindsight_sync_status`
- `hindsight_diagnose`
- `hindsight_search_knowledge_pages`
- `hindsight_list_knowledge_pages`
- `hindsight_read_knowledge_page`
- `hindsight_reflect`
- `hindsight_capture_initiative`
- `hindsight_ingest_document`

In OpenCode 2, Hindsight sets `options.codemode: false` so tools remain directly visible. In Pi, Hindsight sets `exposure: "direct"`.

We evaluated whether to replace or augment these 8 discrete tools with native Code Mode.

## Architecture Needed for Code Mode

To implement native Code Mode, Hindsight MCP must:
1. Expose a discovery tool (`hindsight_search_tools` or `search`) to discover memory APIs and signatures.
2. Expose an execution tool (`hindsight_execute` or `execute`) that receives a JavaScript or TypeScript async function.
3. Inject a pre-authenticated `HindsightClient` instance into the sandbox execution scope.
4. Translate execution errors into structured error payloads.
5. Apply output truncation and safety annotations.

### Effort Estimate
- **T-Shirt Size**: Medium (2–3 engineering days).
- **Scope**: Execution runner, sandbox environment, client injection, schema translation, test suite across harnesses.

## Tradeoffs

### Benefits (Pros)
- Decreases prompt token consumption when many tools exist.
- Allows agents to run multi-step memory reasoning in one turn, such as search, filter, and read in a single call.

### Drawbacks (Cons)
- Surface size: Hindsight exposes only 8 curated tools. The prompt overhead of 8 tools rewritten in STE is minimal.
- Sandbox security: Running arbitrary code strings needs evaluation sandboxes, such as `node:vm` or isolated workers, and agent runtime permissions. Headless runtimes (`dcode -n`) or strict host permissions gate dynamic execution behind approval dialogs.
- Complexity: Debugging multi-step failures inside string payloads is harder for agent harnesses than single tool call telemetry.

## Decision

**Retain direct tool exposure and defer native Code Mode.**

The 8 curated tools now comply with Simplified Technical English (STE), which reduces schema token overhead by ~30%. Because the tool surface is small, native Code Mode adds disproportionate runtime and sandbox complexity without significant token savings.

Re-evaluate native Code Mode when Hindsight exposes fine-grained entity manipulation or more than 20 distinct tools.
