#!/usr/bin/env node
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadBuildView, loadWorkspace, type LintFs } from "./model.js";
import { createNpmPacklistProvider } from "./packlist.js";
import { formatReport } from "./report.js";
import { runRules } from "./rules/index.js";

const nodeFs: LintFs = {
  readFile: (p) => readFile(p, "utf8"),
  readdir: (p) =>
    readdir(p, { withFileTypes: true }) as Promise<{ name: string; isDirectory(): boolean }[]>,
  async stat(p) {
    const stats = await stat(p);
    return { isDirectory: () => stats.isDirectory(), isFile: () => stats.isFile() };
  },
  lstat,
  realpath
};

const HELP = `poe-package-lint — verify workspace packages are configured for publish

Usage: poe-package-lint [options]

Options:
  --json          Emit violations as JSON instead of the rendered report.
  --quiet         Print only violations, suppress the per-rule "clean" lines.
  --rule <id>     Run a single rule by id (repeatable); default runs all.
  -h, --help      Show this help.

Exit codes: 0 clean · 1 violations found · 2 tool error.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      rule: { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: false
  });

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const rootDir = process.cwd();
  try {
    const model = await loadWorkspace(nodeFs, rootDir, {
      packlistProvider: createNpmPacklistProvider(nodeFs)
    });
    const build = await loadBuildView(nodeFs, rootDir);
    const result = runRules(model, build, values.rule);
    process.stdout.write(
      `${formatReport(result, { json: Boolean(values.json), quiet: Boolean(values.quiet) })}\n`
    );
    process.exit(result.summary.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`package-lint: ${(error as Error).message}\n`);
    process.exit(2);
  }
}

void main();
