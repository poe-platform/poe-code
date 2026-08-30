import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { CommandRegistry, dirname, resolvePath } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

interface Fixture {
  readonly name: string;
  readonly tier: "core" | "advanced-pending";
  readonly tags: readonly string[];
  readonly script: string;
  readonly env?: Record<string, string>;
  readonly stdin?: string;
  readonly initialFiles?: Record<string, string>;
  readonly expected: { stdout: string; stderr: string; exitCode: number; files: Record<string, string> };
}

const corpus = JSON.parse(await readFile(new URL("../fixtures/shell-cases.json", import.meta.url), "utf8")) as { fixtures: Fixture[] };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const results: { name: string; tier: string; passed: boolean; differences: Record<string, unknown> }[] = [];

async function snapshot(fs: MemoryFileSystem, directory = "/"): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await fs.readdir(directory)) {
    const path = resolvePath(directory, entry.name);
    if (entry.type === "directory") Object.assign(files, await snapshot(fs, path));
    else files[path.slice(1)] = decoder.decode(await fs.readFile(path));
  }
  return files;
}

for (const fixture of corpus.fixtures) {
  const fs = new MemoryFileSystem();
  for (const [name, content] of Object.entries(fixture.initialFiles ?? {})) {
    const path = resolvePath("/", name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, encoder.encode(content));
  }
  const commands = new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]);
  const shell = new Shell({ fs, commands });
  const differences: Record<string, unknown> = {};
  try {
    const result = await shell.exec(fixture.script, {
      env: fixture.env ?? {}, stdin: fixture.stdin ?? "", signal: AbortSignal.timeout(5000),
    });
    const actual = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, files: await snapshot(fs) };
    for (const key of ["stdout", "stderr", "exitCode", "files"] as const) {
      if (!isDeepStrictEqual(actual[key], fixture.expected[key])) differences[key] = { expected: fixture.expected[key], actual: actual[key] };
    }
  } catch (error) { differences.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
  results.push({ name: fixture.name, tier: fixture.tier, passed: Object.keys(differences).length === 0, differences });
}

const summary = Object.fromEntries(["core", "advanced-pending"].map((tier) => {
  const entries = results.filter((result) => result.tier === tier);
  return [tier, { passed: entries.filter((result) => result.passed).length, total: entries.length }];
}));
console.log(JSON.stringify({ summary, failures: results.filter((result) => !result.passed) }, null, 2));
process.exitCode = results.some((result) => !result.passed && (result.tier === "core" || process.argv.includes("--strict"))) ? 1 : 0;
