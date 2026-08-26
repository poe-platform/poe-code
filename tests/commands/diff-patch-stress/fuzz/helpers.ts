import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { toByteSource, type FileSystem } from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createDiffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import { oracleIdentity, oraclePath } from "../compatibility/oracle.js";

export const BASE_SEED = 0x6d2b79f5;
export const CASE_COUNT = 512;
export const OUTPUT_CAP = 1024 * 1024;

export function random(seed: number): (limit: number) => number {
  let state = seed >>> 0;
  return limit => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % limit;
  };
}

export function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}

export interface Example {
  readonly seed: number;
  readonly index: number;
  readonly family: string;
  readonly before: string;
  readonly after: string;
  readonly context: number;
}

export function example(index: number): Example {
  const seed = (BASE_SEED + Math.imul(index, 0x9e3779b9)) >>> 0;
  const pick = random(seed);
  const mode = index % 16;
  const words = ["", " ", "\t", "same", "same", "alpha", "beta", "🧪", "e\u0301", "é", "漢字", "\ufeffBOM", "-- literal", "++ literal", "@@ -1 +1 @@", "\\ No newline at end of file"];
  const original = Array.from({ length: 4 + pick(28) }, () => `${words[pick(words.length)]!}\n`);
  const changed = original.slice();
  const position = pick(changed.length + 1);
  const token = `value_${seed.toString(16)}`;
  let family = "";
  switch (mode) {
    case 0: family = "empty-create"; original.length = 0; changed.splice(0, changed.length, `${token}\n`); break;
    case 1: family = "empty-delete"; changed.length = 0; break;
    case 2: family = "insert"; changed.splice(position, 0, `${token}\n`, "\n"); break;
    case 3: family = "delete"; changed.splice(pick(changed.length), 1 + pick(3)); break;
    case 4: family = "replace"; changed.splice(pick(changed.length), 1 + pick(3), `${token}\n`); break;
    case 5: {
      family = "repetition";
      original.splice(0, original.length, ...Array.from({ length: 12 + pick(30) }, (_, offset) => `${offset % 3 ? "same" : "anchor"}\n`));
      changed.splice(0, changed.length, ...original);
      changed.splice(pick(changed.length), 1, `${token}\n`);
      changed.splice(pick(changed.length), 0, "same\n");
      break;
    }
    case 6: family = "whitespace"; changed.splice(position, 0, "\t \t\n", " \n", "\n"); break;
    case 7: family = "unicode"; changed.splice(position, 0, `\ufeffλ=${token}; 🧪漢字 e\u0301 é\n`); break;
    case 8: family = "crlf"; changed.splice(position, 0, `${token}\n`); break;
    case 9: family = "terminal-newline"; break;
    case 10: family = "long-lines"; changed.splice(position, 0, `${"x".repeat(2048 + pick(8192))}${token}\n`); break;
    case 11: family = "separated-anchors"; changed[0] = `${token}_first\n`; changed[changed.length - 1] = `${token}_last\n`; break;
    case 12: family = "adjacent-hunks"; changed.splice(1, 1, `${token}_a\n`); changed.splice(3, 1, `${token}_b\n`); break;
    case 13: family = "move"; changed.push(...changed.splice(0, 1 + pick(3))); break;
    case 14: family = "equal"; break;
    case 15: {
      family = "coding-edit";
      original.splice(0, original.length, `import { oldName } from './api.js';\n`, "\n", "export function run(input) {\n", "  return oldName(input);\n", "}\n");
      changed.splice(0, changed.length, `import { ${token} } from './api.js';\n`, "\n", "export function run(input) {\n", "  if (!input) return '';\n", `  return ${token}(input);\n`, "}\n");
      break;
    }
  }
  let before = original.join("");
  let after = changed.join("");
  if (mode === 8) { before = before.replaceAll("\n", "\r\n"); after = after.replaceAll("\n", "\r\n"); }
  if (mode === 9) after = after.slice(0, -1);
  else if (mode !== 14 && pick(3) === 0) {
    before = before.endsWith("\n") ? before.slice(0, -1) : before;
    after = after.endsWith("\n") ? after.slice(0, -1) : after;
  }
  return { seed, index, family, before, after, context: [0, 1, 2, 3, 5, 12][pick(6)]! };
}

export function body(kind: "-" | "+" | " ", text: string): string {
  return lines(text).map(line => `${kind}${line}${line.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`).join("");
}

export function golden(before: string, after: string, target = "target"): string {
  const oldCount = lines(before).length;
  const newCount = lines(after).length;
  if (before === after) return "";
  return `--- ${target}\t2000-01-01 00:00:00 +0000\n+++ ${target}\t2000-01-02 00:00:00 +0000\n@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@ agent replacement\n${body("-", before)}${body("+", after)}`;
}

export function shortestEditDistance(before: string, after: string): number {
  const oldLines = lines(before);
  const newLines = lines(after);
  let frontier = new Map<number, number>([[1, 0]]);
  for (let distance = 0; distance <= oldLines.length + newLines.length; distance++) {
    const next = new Map<number, number>();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -Infinity;
      const right = (frontier.get(diagonal - 1) ?? -Infinity) + 1;
      let oldIndex = diagonal === -distance ? down : diagonal === distance ? right : Math.max(down, right);
      let newIndex = oldIndex - diagonal;
      while (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) { oldIndex++; newIndex++; }
      if (oldIndex >= oldLines.length && newIndex >= newLines.length) return distance;
      next.set(diagonal, oldIndex);
    }
    frontier = next;
  }
  throw new Error("independent shortest path failed");
}

export function editCount(patch: string): number {
  return patch.split("\n").slice(2).filter(line => /^[+-]/u.test(line)).length;
}

export async function memory(files: Readonly<Record<string, string>>): Promise<MemoryFileSystem> {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/work");
  for (const [name, text] of Object.entries(files)) await filesystem.writeFile(`/work/${name}`, Buffer.from(text));
  return filesystem;
}

export async function contents(filesystem: FileSystem, name = "target"): Promise<string> {
  return Buffer.from(await filesystem.readFile(`/work/${name}`, { maxBytes: OUTPUT_CAP })).toString("utf8");
}

export async function run(tool: "diff" | "patch", args: readonly string[], filesystem: FileSystem, input = "", options: DiffPatchOptions = {}) {
  const command = createDiffPatchCommands(options).find(definition => definition.name === tool)!;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let size = 0;
  const capture = (chunks: Buffer[]) => ({ async write(chunk: Uint8Array) {
    size += chunk.byteLength;
    assert(size <= OUTPUT_CAP, "virtual output cap exceeded");
    chunks.push(Buffer.from(chunk));
  } });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("fuzz command exceeded 2000ms")), 2000);
  try {
    const result = await command.execute({ command: tool, args, cwd: "/work", env: {}, fs: filesystem, stdin: toByteSource(input), stdout: capture(stdout), stderr: capture(stderr), signal: controller.signal });
    return { ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
  } finally { clearTimeout(timer); }
}

export async function nativeDirectory<Result>(operation: (root: string) => Promise<Result>): Promise<Result> {
  const root = await mkdtemp(fileURLToPath(new URL("./.native-", import.meta.url)));
  try { return await operation(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

export function native(root: string, tool: "diff" | "patch", args: readonly string[], input = "") {
  const result = spawnSync(oraclePath(tool), [...args], {
    cwd: root, input, encoding: "utf8", timeout: 2000, killSignal: "SIGKILL", maxBuffer: OUTPUT_CAP,
    env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, LC_ALL: "C", LANG: "C", TZ: "UTC" },
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `native ${tool} killed: ${result.signal}`);
  assert.notEqual(result.status, null);
  return { exitCode: result.status!, stdout: result.stdout, stderr: result.stderr };
}

export async function nativeIdentity() {
  return { diff: oracleIdentity("diff"), patch: oracleIdentity("patch") };
}

export async function nativePatch(root: string, before: string, input: string, reverse = false): Promise<string> {
  const result = await nativePatchResult(root, before, input, reverse);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  return result.target;
}

export async function nativePatchResult(root: string, before: string, input: string, reverse = false) {
  await writeFile(join(root, "target"), before);
  const result = native(root, "patch", ["-f", "-F0", "-p0", ...(reverse ? ["-R"] : []), "target"], input);
  return { ...result, target: await readFile(join(root, "target"), "utf8") };
}
