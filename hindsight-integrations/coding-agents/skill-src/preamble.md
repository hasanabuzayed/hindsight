---
name: hindsight-coding-agent
description: How this machine's Hindsight coding-agent memory works — the plugin behind the 🧠 banner. Use when the user says "store/remember this in hindsight", asks what the memory/knowledge pages are, wants to configure per-repo memory (disable, rename banks, git depth), or something memory-related looks broken.
---

# Hindsight Coding-Agent Memory

This machine runs the `hindsight-coding-agents` plugin. The plugin provides long-term project memory for coding sessions, backed by a Hindsight server. The agent connects to it directly. This skill explains what happens automatically, which tools exist, and how to configure or debug memory.

## What happens automatically (no action needed)

- **Per-repo memory bank**: Each repository resolves to a bank. The session banner shows the bank name: `↳ memory bank “coding-agent::<repo>”`. Worktrees share the bank of the main repository.
- **Ingestion builds itself**: On first open, the system seeds the bank from recent commit messages and a read-only codebase survey. At every session start, a background engine updates memory with new commits and conversations. The engine keeps 5 knowledge pages current. There is NO ingest command to run.
- **Session synthesis**: By default, the first prompt of a session triggers one deep memory synthesis (`reflect`) injected into context. `autoInject` switches the source: `pages` (knowledge page search hits), `recall` (recalled observations), or `none` (nothing injected). In `none` mode, the agent searches knowledge pages first and reflects only when pages are too shallow.
- **Write-back**: The system retains the session transcript into the bank automatically at session end, or per-turn on opencode. The user never needs to "save" a conversation.

## Storing things deliberately

When the user says "store this in hindsight" or "remember this":

- The system captures the **current conversation** automatically at session end. Tell this to the user, with no tool needed.
- For an **external document, notes, or durable findings**, call `hindsight_ingest_document(title, content)`.
- For a **new feature/initiative being started**, call `hindsight_capture_initiative(title, summary)`. Call this right after the plan is agreed and before you write code.
- For a **plan that materially changed** in goal, scope, or rationale, including mid-implementation, call `hindsight_capture_initiative` again with `relates_to_page_id` set to that initiative page id. Summarize the current intent on the same page. Update the plan, and never a second page. Trivial course-corrections do not count.

## Retrieving

- `hindsight_search_knowledge_pages(query)` — FIRST STOP for project questions on components, conventions, past decisions, and initiatives. This server-side hybrid search runs quickly.
- `hindsight_read_knowledge_page(page_id)` / `hindsight_list_knowledge_pages` — Read pages completely.
- `hindsight_reflect(query)` — Deep reasoning over full memory for WHY questions and exact decided values. This tool runs slower. Use it deliberately.
- Credit visibly whenever memory informs an answer. Open that text with: `🧠 From Hindsight memory (<page>): …`, without crediting memory that did not contribute.

## Correcting wrong or stale memory

If you verify that Hindsight served wrong or outdated information, fix the record instead of ignoring it. Code, git, or an external source can contradict the memory. Call `hindsight_ingest_document` with:

- **title**: `Correction: <topic>` (for example: `Correction: retry policy 4xx set`)
- **content**: (1) what memory claimed, (2) what is true now, and (3) the evidence you checked (file/commit/output). Quote exact values verbatim.

Newer facts supersede older facts in retrieval. One clear correction permanently outranks stale memory. Ingest a correction whenever you find a wrong injected memory, a stale knowledge-page claim, or an outdated decision. Silent disregard leaves an error for the next session.
