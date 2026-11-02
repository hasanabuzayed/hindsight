/**
 * Knowledge-page MCP tool specs — runtime SDK-free so this stays unit-testable without a real MCP
 * host.
 *
 * `src/mcp-server.ts` is the only file with a runtime MCP SDK import; this module uses only its
 * `ToolAnnotations` type. The server wires the specs returned here into an `McpServer`. Each tool
 * wraps one `HindsightClient` knowledge-page/recall method: it never throws — a thrown client error
 * is caught and turned into an `isError:true` text result so the calling LLM sees the failure
 * instead of the process crashing.
 *
 * The agent-facing surface is intentionally curated: grounding + capture only. Raw page CRUD
 * (create/update/delete) is deliberately NOT exposed — agents never author page structure; they
 * capture initiatives (`hindsight_capture_initiative`) and pages are synthesized/maintained by the
 * server. `hindsight_ingest_document` (raw-content retain) also backs the codebase survey
 * (core/survey.ts).
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import type { HindsightClient } from "./hindsight";
import { syncStatus } from "./status";
import { applyBankConfig, DEFAULT_REFLECT_TOOL_TIMEOUT_MS, loadConfig } from "./config";
import { diagFilePath } from "./diag";
import { describeError } from "./log";
import type { RetainStamp } from "./retain-stamp";
import type { PageTrigger } from "./missions";

export interface ToolResult {
  // Index signature so this structurally satisfies the MCP SDK's CallToolResult (which carries
  // extra optional fields we don't set) when passed to `McpServer.tool()` in src/mcp-server.ts —
  // the only file that imports the SDK; this file stays SDK-free.
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

type ToolSafetyAnnotations = Required<
  Pick<ToolAnnotations, "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint">
>;

const READ_ONLY_ANNOTATIONS: ToolSafetyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const NON_DESTRUCTIVE_WRITE_ANNOTATIONS: ToolSafetyAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/**
 * Returned alongside every search result set.
 *
 * Phrased as an obligation triggered by the CALL, not by the agent judging that it "used" a page: a
 * model that paraphrases a snippet into its own prose does not register itself as having quoted
 * anything, and silently absorbs the memory instead of crediting it.
 */
const CREDIT_REMINDER =
  "Crediting is mandatory. If results inform your reply, quoted or paraphrased, open that part with " +
  '"> 🧠 **From Hindsight memory (<page>)** — <the specific facts you drew on>". ' +
  "Rewriting a snippet in your own words does not make it yours. " +
  "If results do not apply to the turn, ignore them silently because an unhelpful search needs no mention. " +
  "Before you rely on a past record, compare claims against the code.";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  /**
   * Safety metadata published verbatim as the tool's MCP annotations (src/mcp-server.ts).
   *
   * Required, not optional: it is not cosmetic. Dcode gates every MCP tool lacking a coherent
   * read-only annotation behind an approval prompt, so in its headless (`dcode -n`) runtime an
   * unannotated tool is REJECTED outright — "This MCP action requires approval, but the current
   * headless runtime has no approval UI." Codex Auto-review likewise treats an unannotated call as
   * unverified external access. Reads get READ_ONLY_ANNOTATIONS; the two writes get
   * NON_DESTRUCTIVE_WRITE_ANNOTATIONS so clients still gate them, but for the right reason.
   */
  annotations: ToolSafetyAnnotations;
  handler: (args: any) => Promise<ToolResult>;
}

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(e: unknown): ToolResult {
  const message = describeError(e);
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

/** Wrap a handler body so a thrown client error always becomes an isError:true result, never a throw. */
function guarded(fn: (args: any) => Promise<unknown>): (args: any) => Promise<ToolResult> {
  return async (args: any) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return err(e);
    }
  };
}

/** Build the knowledge-page + recall MCP tool specs, bound to one client/bank. */
export function buildKnowledgeTools(
  client: HindsightClient,
  bankId: string,
  opts: {
    repoDir?: string;
    harness?: string;
    stampFor?: () => RetainStamp;
    /** Refresh policy for a page `hindsight_capture_initiative` creates (core/missions.ts). */
    pageTrigger?: PageTrigger;
    /** How long `hindsight_reflect` waits on the server (cfg.reflectToolTimeoutMs). Must be
     *  threaded in by every caller: left unset, the client falls back to a 120s deadline that
     *  aborts high-budget synthesis on a populated bank mid-flight (#3590). */
    reflectTimeoutMs?: number;
    /** Reflect budget for `hindsight_reflect` (cfg.reflectBudget, default "high"). */
    reflectBudget?: "low" | "mid" | "high";
    /** cfg.toolGuideExtra, added after the crediting note so it lands with the results too. */
    toolGuideExtra?: string;
  } = {}
): ToolSpec[] {
  const extra = opts.toolGuideExtra?.trim();
  const crediting = extra ? `${CREDIT_REMINDER} ${extra}` : CREDIT_REMINDER;
  return [
    {
      name: "hindsight_sync_status",
      description:
        "Show sync status for this repository memory bank. Report the git log seed, deepened " +
        "history, ingested conversations, created pages, and active extractions. `synced: true` " +
        "means that the seeded memory is queryable. Ingestion runs automatically in the " +
        "background. If the bank is not in sync, ingestion is in progress and you do not need to run a " +
        "command.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
      handler: async () => {
        try {
          return ok(await syncStatus(client, bankId, opts.repoDir ?? process.cwd()));
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "hindsight_diagnose",
      description:
        "Report safe runtime diagnostics for this session. The report includes the bank, " +
        "workspace, harness, config path, API endpoint, and environment overrides. If memory, " +
        "hooks, MCP tools, or configuration do not work, run this tool. The tool never returns " +
        "tokens or other secret values.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
      handler: async (_args: Record<string, never>) => {
        const configPath =
          process.env.HINDSIGHT_CONFIG || join(homedir(), ".hindsight", "coding-agent.json");
        const harness = opts.harness ?? "unknown";
        // Resolve through the SAME pipeline the host used — including the `banks.<id>` section for
        // the bank this client is bound to, which may carry its own apiToken/apiUrl. A bare
        // loadConfig() would report a mismatch for every per-bank credential.
        const cfg = applyBankConfig(
          loadConfig({ harness: opts.harness }),
          bankId,
          opts.repoDir
        ).cfg;
        return ok({
          bank_id: bankId,
          harness,
          workspace: opts.repoDir ?? process.cwd(),
          config: {
            path: configPath,
            exists: existsSync(configPath),
            api_url: cfg.apiUrl,
            api_token_configured: Boolean(cfg.apiToken),
            disabled: cfg.disabled,
          },
          // What the LIVE client is signing with, which is not the same question as what the file
          // says. A long-lived host used to keep a credential the config had already replaced, and
          // this tool reported that state as perfectly healthy (#3600). Booleans only — the token
          // value is never returned.
          credential: {
            api_token_in_use: Boolean(client.apiToken),
            api_token_matches_config: client.apiToken === cfg.apiToken,
          },
          environment: {
            config_override: Boolean(process.env.HINDSIGHT_CONFIG),
            hooks_disabled: Boolean(process.env.HINDSIGHT_DISABLE_HOOKS),
            log_level: process.env.HINDSIGHT_LOG_LEVEL ?? null,
            diagnostics_file: diagFilePath(),
            channel_id_configured: Boolean(process.env.HINDSIGHT_CHANNEL_ID),
            user_id_configured: Boolean(process.env.HINDSIGHT_USER_ID),
          },
        });
      },
    },
    {
      name: "hindsight_search_knowledge_pages",
      description:
        "Search repository knowledge pages for content relevant to a query. The server runs " +
        "hybrid full-text and semantic search. If project knowledge can answer a question, call " +
        "this tool instead of reading code. Project knowledge includes architecture, conventions, " +
        "decisions, and initiatives. The tool returns ranked pages with snippets. Use " +
        // Same sentence the payload carries, from the same constant: two copies of a rule this
        // fiddly drift apart, and the description is what a host shows when the tool is listed.
        "hindsight_read_knowledge_page to read a full page. " +
        crediting,
      inputSchema: { query: z.string().describe("Text to search for") },
      annotations: READ_ONLY_ANNOTATIONS,
      handler: async (args: { query: string }) => {
        try {
          // Limit comes from the client (`pageSearchLimit`), so the tool and the hook's injection
          // can never drift apart — this used to pass its own literal 3.
          const hits = await client.searchKnowledgePages(args.query);
          // No `score`. The server fuses BM25 and vector search with reciprocal rank fusion, so the
          // number is ~1/(60+rank) summed over two retrievers: a perfect top hit scores about 0.03
          // and nothing ever approaches 1. Handed that, a model reads a strong match as 3% relevant
          // and discounts it. The hits arrive in rank order, which is the ranking that means
          // something here.
          // The reminder rides WITH the hits, not only in the session guide. Measured on real
          // sessions: the agent searched, got ten on-topic pages, wrote an answer built from them
          // and credited nothing — then credited correctly the moment the user asked "where did you
          // see that?". The guide had scrolled far up the context by then; the instruction that
          // lands at the same moment as the results is the one that can still be acted on.
          return ok({
            pages: hits.map((h) => ({
              page: h.name,
              page_id: h.id,
              // The question the page answers — the same `description` the list and read tools
              // carry, so a hit says what the page is FOR, not just how it opens.
              ...(h.source_query ? { description: h.source_query } : {}),
              snippet: h.snippet,
            })),
            crediting,
          });
        } catch (e) {
          return err(e);
        }
      },
    },
    {
      name: "hindsight_list_knowledge_pages",
      description:
        "List repository knowledge pages. These pages summarize project architecture, components, " +
        "conventions, decisions, and initiatives. The tool returns the id, title, and description " +
        "for each page. At the start of a task, call this tool to see stored knowledge before you " +
        "read code. Call this tool again in long sessions because the list changes when you record " +
        "work.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
      handler: guarded(async () => client.listPages()),
    },
    {
      name: "hindsight_read_knowledge_page",
      description:
        "Read the full content of one knowledge page by its id from " +
        "hindsight_list_knowledge_pages. If a listed page applies to your task, call this tool before " +
        "you start. For example, read Conventions before writing code, or read an initiative page " +
        "before continuing a feature. A page can include [[page:<id>]] links to related pages. To " +
        "open one related page, call this tool again with that id. Prefer reading a page rather than " +
        "re-deriving information from source files.",
      inputSchema: { page_id: z.string() },
      annotations: READ_ONLY_ANNOTATIONS,
      handler: guarded(async ({ page_id }) => client.getPage(page_id)),
    },
    {
      name: "hindsight_reflect",
      description:
        "Reason deeply across repository memory. The tool synthesizes git decisions, past " +
        "sessions, and ingested knowledge to answer why questions. It finds the past decision and " +
        "exact rule/values that explain a behavior. This tool is slower than " +
        "hindsight_search_knowledge_pages. If knowledge pages are too shallow, call this tool for the " +
        "root cause. When the answer informs your reply, credit the memory with this blockquote " +
        'header: "> 🧠 **From Hindsight memory** — <summary>".',
      inputSchema: { query: z.string().describe("the question to reason over memory about") },
      annotations: READ_ONLY_ANNOTATIONS,
      handler: guarded(async ({ query }: { query: string }) =>
        client.reflect(query, {
          budget: opts.reflectBudget ?? "high",
          timeoutMs: opts.reflectTimeoutMs ?? DEFAULT_REFLECT_TOOL_TIMEOUT_MS,
        })
      ),
    },
    {
      name: "hindsight_capture_initiative",
      description:
        "Record a new feature or initiative as a tracked knowledge page. This records the " +
        "initiative so future sessions can use it.\n\n" +
        "WHEN TO CALL:\n" +
        "- Starting one: Before you write any code, call this tool after the user approves a plan " +
        "for a new feature/" +
        "capability. Leave relates_to_page_id empty.\n" +
        "- Plan changed: Call it AGAIN whenever the goal, scope, or rationale of an initiative " +
        "materially changes. A call mid-implementation is fine and expected. Pass relates_to_page_id " +
        "= that initiative's page id. Never mint a second page for the same initiative.\n\n" +
        "WHEN TO SKIP: Bug fixes, small tweaks, refactors, chores, and trivial course-corrections " +
        "are not initiatives. Skip them.\n\n" +
        "- title: Short, specific name like 'Newsletter refinement chat'. On a recapture, reuse the " +
        "existing title.\n" +
        "- summary: State what you build and why in 2-3 sentences. Describe the CURRENT intent, not " +
        "the first plan. On a recapture, state what changed.\n" +
        "- relates_to_page_id: Leave empty for a new initiative. Set this parameter to an existing " +
        "page id from hindsight_list_knowledge_pages to record a plan change.\n\n" +
        "The tool returns the page id. The server creates the page for you. You never format one yourself.",
      inputSchema: {
        title: z.string(),
        summary: z.string(),
        relates_to_page_id: z.string().optional(),
      },
      annotations: NON_DESTRUCTIVE_WRITE_ANNOTATIONS,
      handler: guarded(async ({ title, summary, relates_to_page_id }) =>
        client.captureInitiative({
          title,
          summary,
          relatesToPageId: relates_to_page_id,
          ...(opts.stampFor ? { stamp: opts.stampFor() } : {}),
          ...(opts.pageTrigger ? { pageTrigger: opts.pageTrigger } : {}),
        })
      ),
    },
    {
      name: "hindsight_ingest_document",
      description:
        "Save an external document or notes/findings into repository memory for future recall and " +
        "pages. Use this tool for design notes, research, or reference material, but not for the " +
        "active conversation. This tool is also the correction mechanism. If a retrieved memory is " +
        "wrong or outdated, ingest a document titled 'Correction: <topic>'. State what memory " +
        "claimed, what is actually true, and the evidence. The newer fact supersedes the stale one " +
        "in future retrieval.",
      inputSchema: { title: z.string(), content: z.string() },
      annotations: NON_DESTRUCTIVE_WRITE_ANNOTATIONS,
      handler: guarded(async ({ title, content }) => {
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        // ASCII-only slugs erased non-Latin titles (or shared the "doc" fallback),
        // overwriting unrelated documents. Hash the original title, not its content,
        // so re-ingestion still updates it; "--" cannot occur in a legacy slug.
        const docId =
          /[^\x00-\x7f]/.test(title) || !slug
            ? `${slug || "doc"}--${createHash("sha256").update(title).digest("hex")}`
            : slug;
        const stamp = opts.stampFor?.();
        const metadata = {
          ...stamp?.metadata,
          ...(opts.harness ? { harness: opts.harness } : {}),
        };
        await client.retain(
          content,
          "ingested document",
          docId,
          [
            ...new Set([
              ...(stamp?.tags ?? []),
              "source:upload",
              ...(opts.harness ? [`harness:${opts.harness}`] : []),
            ]),
          ],
          "document",
          Object.keys(metadata).length ? { metadata } : {}
        );
        return { ok: true, doc_id: docId };
      }),
    },
  ];
}
