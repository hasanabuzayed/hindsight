#!/usr/bin/env node
/**
 * hindsight-seed — manual control command.
 * The `seed` argument forces an immediate background backfill of a repository bank.
 * The `decline` argument opts a repository out of auto-seeding.
 * The Claude SessionStart hook in `core/session-start.ts` runs normal seeding automatically and deterministically.
 * This CLI is not part of that automatic path.
 * It is for forcing/opting-out by hand.
 *
 * This command currently supports only Claude Code.
 * The file sets the harness to "claude-code" below.
 * The Claude Code SessionStart flow in Task 10b is the only caller of this CLI.
 * If another harness runs this CLI with a non-default `bankIdTemplate`, the hardcoded harness will resolve the wrong bank.
 * A non-default `harnesses.<name>` override in the config causes the same error.
 * A generalization needs a real `--harness` flag, not added here.
 */
import { loadConfig } from "./core/config";
import { deriveBankIdOrSkip } from "./core/bank";
import { seedControl } from "./core/seed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const command = process.argv[2] || "";
const repo = arg("repo") || process.cwd();
const cfg = loadConfig({ harness: "claude-code" });
const bankId = deriveBankIdOrSkip(cfg, repo, "claude-code");
if (bankId === null) {
  console.error(
    `seed: cannot identify the repository at ${repo} — refusing to seed a guessed bank`
  );
  process.exit(1);
}
const result = seedControl(command, { repo, bankId });
console.log(result.message);
process.exit(result.ok ? 0 : 1);
