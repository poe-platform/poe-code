import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { run } from "../formats/helpers.js";
import { editflows } from "../formats/fixtures.js";
import { cases as parserCases } from "../parser-regressions/fixtures.js";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../../..");
const baseline = "/tmp/safe-bash-diff-checkpoint-Fpgf5L-evidence";
const frozenRoot = "/tmp/safe-bash-diff-checkpoint-Fpgf5L";
const { run: frozenRun } = await import(pathToFileURL(join(frozenRoot, "tests/commands/diff-patch-stress/formats/helpers.ts")).href) as { run: typeof run };
const { MemoryFileSystem: FrozenMemory } = await import(pathToFileURL(join(frozenRoot, "src/fs/memory/index.ts")).href) as { MemoryFileSystem: typeof MemoryFileSystem };
const paths = {
  diff: "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff",
  patch: "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch",
  appleDiff: "/usr/bin/diff",
  applePatch: "/usr/bin/patch",
};
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const cap = 512 * 1024;
type Files = Record<string, string>;
type Tree = Record<string, string | { directory: true } | { unreadable: true; mode: number; bytes: number }>;

async function tree(directory: string): Promise<Tree> {
  const result: Tree = {};
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const name = relative(directory, path);
      if (entry.isDirectory()) { result[name] = { directory: true }; await walk(path); }
      else {
        assert(entry.isFile());
        const metadata = await stat(path);
        if ((metadata.mode & 0o444) === 0 || metadata.size > cap) result[name] = { unreadable: true, mode: metadata.mode, bytes: metadata.size };
        else result[name] = await readFile(path, "utf8");
      }
    }
  }
  await walk(directory);
  return result;
}

async function native(tool: keyof typeof paths, args: readonly string[], files: Files = {}, input = "") {
  assert(Buffer.byteLength(input) <= cap);
  const directory = await mkdtemp(join(owned, ".native-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      assert(!name.startsWith("/") && !name.split("/").includes(".."));
      assert(Buffer.byteLength(text) <= cap);
      await mkdir(dirname(join(directory, name)), { recursive: true });
      await writeFile(join(directory, name), text, { flag: "wx" });
    }
    const before = await tree(directory);
    const started = performance.now();
    const result = await new Promise<{ exitCode: number | null; signal: string | null; bounded: string | null; stdout: string; stderr: string }>((resolveResult, reject) => {
      const child = spawn(paths[tool], [...args], {
        cwd: directory, shell: false, stdio: ["pipe", "pipe", "pipe"],
        env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, PATCH_GET: "0" },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let bounded: string | null = null;
      const stop = (reason: string) => { bounded ??= reason; child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop("timeout-3000ms"), 3000);
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > cap) stop("combined-output-512KiB");
        else chunks.push(chunk);
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolveResult({ exitCode, signal, bounded, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") stop(`stdin-${error.code}`); });
      child.stdin.end(input);
    });
    return { binary: paths[tool], args, input, before, ...result, milliseconds: performance.now() - started, after: await tree(directory) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function product(tool: "diff" | "patch", args: readonly string[], files: Files, input = "", frozen = false) {
  const fs = frozen ? new FrozenMemory() : new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(dirname(`/work/${name}`), { recursive: true });
    await fs.writeFile(`/work/${name}`, Buffer.from(text));
  }
  const result = await (frozen ? frozenRun : run)(tool, args, { fs, input, signal: AbortSignal.timeout(5000) });
  const after: Tree = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.type === "directory") { after[path.slice(6)] = { directory: true }; await walk(path); }
      else after[path.slice(6)] = Buffer.from(await fs.readFile(path, { maxBytes: cap })).toString();
    }
  }
  await walk("/work");
  return { args, input, before: files, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, after };
}

async function fingerprints() {
  const result: Record<string, string> = {};
  for (const name of await readdir(join(root, "src/commands/diff-patch"))) result[`src/commands/diff-patch/${name}`] = sha256(await readFile(join(root, "src/commands/diff-patch", name)));
  for (const path of ["tests/commands/diff-patch-stress/formats/fixtures.ts", "tests/commands/diff-patch-stress/formats/helpers.ts", "tests/commands/diff-patch-stress/parser-regressions/fixtures.ts", "tests/commands/diff-patch-stress/compatibility/diff.test.ts", "tests/commands/diff-patch-stress/fuzz/regressions.test.ts"]) result[path] = sha256(await readFile(join(root, path)));
  return result;
}

const beforeHashes = await fingerprints();
const headBefore = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const sourceStatusBefore = spawnSync("git", ["status", "--short", "--", "src/commands/diff-patch"], { cwd: root, encoding: "utf8" }).stdout;
const primarySources = [];
for (const path of [
  "/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff.c",
  "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch.c",
  "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/pch.c",
  "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/util.c",
  "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/patch.man",
]) primarySources.push({ path, sha256: sha256(await readFile(path)) });
const frozenHashes: Record<string, string> = {};
const checkpoint = JSON.parse(await readFile(join(root, "tests/commands/diff-patch-stress/checkpoint/checkpoint.json"), "utf8")) as { integrity: { scoped: Record<string, string> } };
for (const name of Object.keys(checkpoint.integrity.scoped).filter(path => path.startsWith("src/commands/diff-patch/"))) {
  frozenHashes[name] = sha256(await readFile(join(frozenRoot, name)));
  assert.equal(frozenHashes[name], checkpoint.integrity.scoped[name]);
}
const identities = [];
for (const tool of Object.keys(paths) as (keyof typeof paths)[]) {
  const result = await native(tool, ["--version"]);
  assert.equal(result.exitCode, 0);
  identities.push({ tool, binary: paths[tool], sha256: sha256(await readFile(paths[tool])), version: result.stdout.split("\n")[0] });
}
assert.equal(identities[0]!.sha256, "f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9");
assert.equal(identities[1]!.sha256, "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00");
const failures = [];
const frozenArtifacts = [];
for (const name of ["compatibility.stdout", "formats-full.stdout", "parser-regressions-corrected.stdout"]) {
  const text = await readFile(join(baseline, name), "utf8");
  frozenArtifacts.push({ name, sha256: sha256(text) });
  for (const match of text.matchAll(/^not ok (\d+) - (.+)$/gm)) {
    const testName = match[2]!;
    const category = /diff flags:|Shell\+Memory|option interactions|GNU selector regression/.test(testName) ? "gnu-selector-defect"
      : /GAP-01 raw|GNU boundary anchoring/.test(testName) ? "gnu-patch-defect"
      : /^native-native control/.test(testName) ? "gnu-native-native-control"
      : /^independent formatter/.test(testName) ? "apple-reverse-control"
      : "parser-native-control";
    failures.push({ artifact: name, ordinal: Number(match[1]), name: testName, category });
  }
}
assert.equal(failures.length, 30);
const selectors = [];
const labels = ["--label=target", "--label=target"];
const selectorFiles = { old: "a\nb\nc\nd\ne\nf\ng\n", new: "A\nb\nc\nd\ne\nf\nG\n" };
for (const flags of [["-U0", "-u"], ["-U0", "--unified"], ["--unified=1", "-ru"], ["-u", "-U", "0"], ["-C0", "-c"], ["-U5", "-U1"], ["-C5", "-c"], ["-U0"], ["--unified=1"]]) {
  const args = [...flags, ...labels, "old", "new"];
  selectors.push({ flags, gnu: await native("diff", args, selectorFiles), apple: await native("appleDiff", args, selectorFiles), product: await product("diff", args, selectorFiles), frozenProduct: await product("diff", args, selectorFiles, "", true) });
}
const nativePatchArgs = ["--batch", "--binary", "--fuzz=0", "--no-backup-if-mismatch", "target"];
const formats = [];
for (const name of ["delete-3", "delete-7", "delete-11", "repeated-alignment-0", "repeated-alignment-7", "repeated-alignment-11"]) {
  const flow = editflows.find(entry => entry.name === name)!;
  assert(flow);
  const args = ["-C0", ...labels, "old", "new"];
  const gnuDiff = await native("diff", args, { old: flow.old, new: flow.next });
  const productDiff = await product("diff", args, { old: flow.old, new: flow.next });
  const frozenDiff = await product("diff", args, { old: flow.old, new: flow.next }, "", true);
  const directions = [];
  for (const reverse of [false, true]) {
    const flags = reverse ? ["-R"] : [];
    const files = { target: reverse ? flow.next : flow.old };
    directions.push({ reverse, expected: reverse ? flow.old : flow.next,
      gnuOnGnu: await native("patch", [...flags, ...nativePatchArgs], files, gnuDiff.stdout),
      gnuOnProduct: await native("patch", [...flags, ...nativePatchArgs], files, productDiff.stdout),
      appleOnGnu: await native("applePatch", [...flags, "-f", "-F0", "target"], files, gnuDiff.stdout),
      appleOnProduct: await native("applePatch", [...flags, "-f", "-F0", "target"], files, productDiff.stdout),
      productOnGnu: await product("patch", [...flags, "target"], files, gnuDiff.stdout),
      productOnProduct: await product("patch", [...flags, "target"], files, productDiff.stdout),
      gnuOnFrozen: await native("patch", [...flags, ...nativePatchArgs], files, frozenDiff.stdout),
      frozenOnGnu: await product("patch", [...flags, "target"], files, gnuDiff.stdout, true),
      frozenOnFrozen: await product("patch", [...flags, "target"], files, frozenDiff.stdout, true),
    });
  }
  formats.push({ name, flow, gnuDiff, productDiff, frozenDiff, identicalDiff: gnuDiff.stdout === productDiff.stdout, identicalFrozenDiff: gnuDiff.stdout === frozenDiff.stdout, directions });
}
const parser = [];
const parserArgs = ["--batch", "--forward", "--fuzz=0", "--no-backup-if-mismatch", "--reject-file=reject", "--", "target"];
for (const id of ["normal-tab-prefix", "normal-suppress-blank-empty", "normal-unsafe-integer"]) {
  const fixture = parserCases.find(entry => entry.id === id)!;
  assert(fixture);
  const diffFlags = id === "normal-tab-prefix" ? ["--normal", "--initial-tab"] : ["--normal", "--suppress-blank-empty"];
  parser.push({ id, fixture,
    generated: fixture.after === undefined ? null : await native("diff", [...diffFlags, ...labels, "old", "new"], { old: fixture.before, new: fixture.after }),
    gnu: await native("patch", parserArgs, { target: fixture.before, other: "old\n" }, fixture.patch),
    apple: await native("applePatch", ["-f", "-F0", "target"], { target: fixture.before }, fixture.patch),
    product: await product("patch", ["target"], { target: fixture.before, other: "old\n" }, fixture.patch),
    frozenProduct: await product("patch", ["target"], { target: fixture.before, other: "old\n" }, fixture.patch, true),
  });
}
for (const entry of [
  { id: "GNU-normal-suppress-blank-empty", old: "old\n", next: "\n", flags: ["--normal", "--suppress-blank-empty"] },
  { id: "GNU-context-zero-middle-deletion", old: "left\nremoved\nright\n", next: "left\nright\n", flags: ["-C0"] },
]) {
  const diff = await native("diff", [...entry.flags, ...labels, "old", "new"], { old: entry.old, new: entry.next });
  parser.push({ id: entry.id, fixture: entry, generated: diff,
    gnu: await native("patch", parserArgs, { target: entry.old, other: "old\n" }, diff.stdout),
    apple: await native("applePatch", ["-f", "-F0", "target"], { target: entry.old }, diff.stdout),
    product: await product("patch", ["target"], { target: entry.old }, diff.stdout),
    frozenProduct: await product("patch", ["target"], { target: entry.old }, diff.stdout, true),
  });
}
const patchCases = [
  { name: "legacy-empty-range-forward", before: "a\nb\n", input: "--- target\n+++ target\n@@ -1 +1,0 @@\n-a\n", flags: [] },
  { name: "legacy-empty-range-reverse", before: "b\n", input: "--- target\n+++ target\n@@ -1 +1,0 @@\n-a\n", flags: ["-R"] },
  { name: "canonical-empty-range-reverse", before: "b\n", input: "--- target\n+++ target\n@@ -1 +0,0 @@\n-a\n", flags: ["-R"] },
  { name: "asymmetric-non-EOF", before: "prefix\nhead\nold\ntail\n", input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n", flags: [] },
  { name: "asymmetric-EOF", before: "prefix\nhead\nold\n", input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n", flags: [] },
  { name: "symmetric-displaced", before: "prefix\nhead\nold\ntail\n", input: "--- target\n+++ target\n@@ -1,3 +1,3 @@\n head\n-old\n+new\n tail\n", flags: [] },
];
const patch = [];
for (const entry of patchCases) patch.push({ ...entry,
  gnu: await native("patch", [...entry.flags, ...nativePatchArgs], { target: entry.before }, entry.input),
  apple: await native("applePatch", [...entry.flags, "-f", "-F0", "target"], { target: entry.before }, entry.input),
  product: await product("patch", [...entry.flags, "-F0", "target"], { target: entry.before }, entry.input),
  frozenProduct: await product("patch", [...entry.flags, "-F0", "target"], { target: entry.before }, entry.input, true),
});
const deletion = "--- dir/sub/target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
const empty = "--- dir/sub/target\n+++ dir/sub/target\n@@ -1 +0,0 @@\n-old\n";
const mixed = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+NEW\n@@ -3 +3 @@\n-not-present\n+END\n";
const multi = "--- first\n+++ first\n@@ -1 +1 @@\n-old\n+NEW\n--- second\n+++ second\n@@ -1 +1 @@\n-absent\n+NEW\n--- third\n+++ third\n@@ -1 +1 @@\n-old\n+NEW\n";
const malformedLater = "--- first\n+++ first\n@@ -1 +1 @@\n-old\n+NEW\n--- second\n+++ second\n@@ -1 +1 @@\n-old\n";
const mutations = [];
for (const entry of [
  { name: "delete-prunes-parents", files: { "dir/sub/target": "old\n" }, input: deletion, flags: [] },
  { name: "delete-keeps-nonempty-parent", files: { "dir/sub/target": "old\n", "dir/sibling": "stay\n" }, input: deletion, flags: [] },
  { name: "empty-without-E", files: { "dir/sub/target": "old\n" }, input: empty, flags: [] },
  { name: "E-prunes-parents", files: { "dir/sub/target": "old\n" }, input: empty, flags: ["-E"] },
  { name: "dry-run-no-pruning", files: { "dir/sub/target": "old\n" }, input: deletion, flags: ["--dry-run"] },
  { name: "same-file-partial-default-reject", files: { target: "old\nkeep\nend\n" }, input: mixed, flags: [] },
  { name: "multi-file-partial-default-reject", files: { first: "old\n", second: "old\n", third: "old\n" }, input: multi, flags: [] },
  { name: "explicit-reject-file", files: { target: "old\nkeep\nend\n" }, input: mixed, flags: ["--reject-file=chosen.rej"] },
  { name: "discard-reject-file", files: { target: "old\nkeep\nend\n" }, input: mixed, flags: ["--reject-file=-"] },
  { name: "dry-run-partial-no-reject", files: { target: "old\nkeep\nend\n" }, input: mixed, flags: ["--dry-run"] },
  { name: "malformed-later-section", files: { first: "old\n", second: "old\n" }, input: malformedLater, flags: [] },
  { name: "partial-keeps-later-matching-hunk", files: { target: "old\nkeep\nend\n" }, input: mixed + "@@ -3 +3 @@\n-end\n+FINAL\n", flags: [] },
]) mutations.push({ ...entry,
  gnu: await native("patch", ["--batch", "--fuzz=0", "--no-backup-if-mismatch", "-p0", ...entry.flags], entry.files as Files, entry.input),
  product: await product("patch", ["-F0", "-p0", ...entry.flags], entry.files as Files, entry.input),
});
const afterHashes = await fingerprints();
assert.deepEqual(afterHashes, beforeHashes, "source/fixture drift invalidates this capture");
const compatibilityIssues = [
  ...selectors.filter(entry => entry.gnu.stdout !== entry.product.stdout || entry.gnu.exitCode !== entry.product.exitCode).map(entry => `selector ${entry.flags.join(" ")}`),
  ...patch.filter(entry => entry.gnu.exitCode !== entry.product.exitCode || entry.gnu.after.target !== entry.product.after.target).map(entry => `patch ${entry.name}`),
  ...mutations.filter(entry => entry.gnu.exitCode !== entry.product.exitCode || JSON.stringify(Object.entries(entry.gnu.after).sort()) !== JSON.stringify(Object.entries(entry.product.after).sort())).map(entry => `mutation ${entry.name}`),
  ...formats.flatMap(entry => entry.directions.flatMap(direction => [
    ...(direction.productOnGnu.exitCode !== 0 || direction.productOnGnu.after.target !== direction.expected ? [`format parser ${entry.name} reverse=${direction.reverse}`] : []),
    ...(direction.productOnProduct.exitCode !== 0 || direction.productOnProduct.after.target !== direction.expected ? [`format roundtrip ${entry.name} reverse=${direction.reverse}`] : []),
    ...(!entry.identicalDiff && (direction.gnuOnProduct.exitCode !== 0 || direction.gnuOnProduct.after.target !== direction.expected) ? [`format unvalidated alternate ${entry.name} reverse=${direction.reverse}`] : []),
  ])),
  ...parser.filter(entry => entry.product.exitCode !== (entry.id === "normal-unsafe-integer" ? 2 : 0)
    || entry.product.after.target !== entry.frozenProduct.after.target).map(entry => `parser ${entry.id}`),
];
const calibrationReference = JSON.parse(await readFile(join(owned, "evidence.json"), "utf8")) as { formats: typeof formats; parser: typeof parser };
const calibrationIssues = [
  ...formats.flatMap(entry => entry.directions.filter(direction => direction.gnuOnGnu.exitCode !== 2
    || !direction.gnuOnGnu.stderr.includes("replacement text or line numbers mangled")
    || direction.appleOnGnu.exitCode !== 0
    || (direction.appleOnGnu.after.target === direction.expected) !== (!direction.reverse || entry.name === "repeated-alignment-0"))
    .map(direction => `format native calibration ${entry.name} reverse=${direction.reverse}`)),
  ...parser.filter(entry => entry.id === "normal-unsafe-integer"
    ? entry.gnu.bounded !== "timeout-3000ms" || entry.gnu.signal !== "SIGKILL" || entry.gnu.after.target !== entry.gnu.before.target
    : entry.gnu.exitCode !== 2 || entry.gnu.after.target !== entry.gnu.before.target).map(entry => `parser native calibration ${entry.id}`),
  ...formats.flatMap(entry => entry.directions.filter(direction => {
    const reference = calibrationReference.formats.find(row => row.name === entry.name)!.directions.find(row => row.reverse === direction.reverse)!;
    return direction.appleOnGnu.after.target !== reference.appleOnGnu.after.target
      || direction.gnuOnGnu.stderr !== reference.gnuOnGnu.stderr
      || direction.gnuOnGnu.stdout !== reference.gnuOnGnu.stdout;
  }).map(direction => `exact native calibration ${entry.name} reverse=${direction.reverse}`)),
  ...parser.filter(entry => {
    if (entry.id === "normal-unsafe-integer") return false;
    const reference = calibrationReference.parser.find(row => row.id === entry.id)!;
    return entry.gnu.stderr !== reference.gnu.stderr || entry.gnu.stdout !== reference.gnu.stdout;
  }).map(entry => `exact parser calibration ${entry.id}`),
];
const evidence = {
  capturedAt: new Date().toISOString(), node: process.version,
  head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  baselineCommit: "b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed", baseline, frozenArtifacts,
  headBefore, sourceStatusBefore, primarySources, identities, beforeHashes, afterHashes, frozenRoot, frozenHashes, failures, selectors, formats, parser, patch, mutations, compatibilityIssues, calibrationIssues,
};
if (process.argv.includes("--record")) {
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const path = relative(root, join(owned, "evidence.json"));
  const result = spawnSync("apply_patch", [`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`], { cwd: root, encoding: "utf8", maxBuffer: cap });
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
  console.log(JSON.stringify({ failures: failures.length, compatibilityIssues, calibrationIssues }, null, 2));
} else console.log(JSON.stringify(evidence, null, 2));
if (process.argv.includes("--gate") && (compatibilityIssues.length || calibrationIssues.length)) process.exitCode = 1;
