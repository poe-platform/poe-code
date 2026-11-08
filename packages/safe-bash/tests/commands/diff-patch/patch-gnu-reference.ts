import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "./helpers.js";

const binary = process.env.GNU_PATCH_BINARY;
if (!binary) throw new Error("Set GNU_PATCH_BINARY to the verified GNU patch 2.8 executable");
const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 3000, maxBuffer: 65_536 });
assert.equal(version.status, 0);
assert.match(version.stdout, /^GNU patch 2\.8\n/u);
const results: unknown[] = [];

async function compare(name: string, input: string, initial: string | undefined, args: string[], expected: string | undefined) {
  assert(Buffer.byteLength(input) < 65_536);
  const boundary = await mkdtemp(resolve(".git/patch-reference-"));
  const directory = resolve(boundary, "work");
  try {
    await mkdir(directory);
    await writeFile(resolve(boundary, "boundary"), "fixture boundary\n", { flag: "wx" });
    const target = resolve(directory, "target");
    if (initial !== undefined) await writeFile(target, initial, { flag: "wx" });
    const nativeArgs = args.map(arg => arg === "/work/target" ? target : arg);
    const native = spawnSync(binary!, ["--batch", ...nativeArgs], {
      cwd: directory, input, encoding: "utf8", shell: false, timeout: 3000, maxBuffer: 65_536,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: directory, TMPDIR: directory, PATCH_GET: "0" },
    });
    if (native.error) throw native.error;
    assert.equal(native.status, 0, `${name}: ${native.stdout}${native.stderr}`);
    let actual: string | undefined;
    try { actual = await readFile(target, "utf8"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    assert.equal(actual, expected, `${name}: native bytes/existence`);
    const virtual = await run("patch", ["--batch", ...args], { input, files: initial === undefined ? {} : { target: initial } });
    assert.equal(virtual.exitCode, native.status, `${name}: ${virtual.stderr}`);
    let virtualContent: string | undefined;
    try { virtualContent = Buffer.from(await virtual.fs.readFile("/work/target")).toString("utf8"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    assert.equal(virtualContent, actual, `${name}: virtual bytes/existence`);
    results.push({ name, args: ["--batch", ...args], input, initial: initial ?? null, expected: expected ?? null, nativeStatus: native.status,
      virtualStatus: virtual.exitCode, stdout: native.stdout.replaceAll(directory, "<isolated-root>"), stderr: native.stderr, pass: true });
  } finally { await rm(boundary, { recursive: true, force: true }); }
}

const now = "2026-08-26 00:00:00 +0000";
for (const date of ["1970-01-01 00:00:00 +0000", "1969-12-31 19:00:00 -0500", "Thu Jan  1 00:00:00 1970",
  "1970-01-01 00:00:00.900000000 +0000", "1970-01-01 00:00:01 +0000", "1970-01-01 00:00:00"]) {
  for (const format of ["unified", "context"]) {
    const input = format === "unified"
      ? `--- target\t${date}\n+++ target\t${now}\n@@ -0,0 +1 @@\n+new\n`
      : `*** target\t${date}\n--- target\t${now}\n***************\n*** 0 ****\n--- 1 ----\n+ new\n`;
    for (const target of [[], ["/work/target"]]) {
      const label = `${format}/${date}/${target.length ? "absolute" : "auto"}`;
      await compare(`${label}/create`, input, undefined, target, "new\n");
      await compare(`${label}/existing-empty`, input, "", target, "new\n");
      await compare(`${label}/dry-run-create`, input, undefined, ["--dry-run", ...target], undefined);
      await compare(`${label}/reverse-delete`, input, "new\n", ["-R", ...target], undefined);
      await compare(`${label}/dry-run-delete`, input, "new\n", ["-R", "--dry-run", ...target], "new\n");
    }
  }
}
for (const [format, input] of [
  ["normal", "1c1\n< old\n---\n> new\n"],
  ["context", "*** /unused/old\n--- /unused/new\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n"],
  ["unified", "--- /unused/old\n+++ /unused/new\n@@ -1 +1 @@\n-old\n+new\n"],
] as const) {
  await compare(`${format}/explicit-absolute`, input, "old\n", ["/work/target"], "new\n");
  await compare(`${format}/explicit-absolute-reverse`, input, "new\n", ["-R", "/work/target"], "old\n");
}
const formats = {
  normal: "1c1\n< old\n---\n> new\n",
  context: "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n",
  unified: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n",
};
for (const [format, input] of Object.entries(formats)) for (const fileCR of [false, true]) {
  const data = fileCR ? input.replace("old\n", "old\r\n").replace("new\n", "new\r\n") : input;
  await compare(`${format}/transport/fileCR=${fileCR}`, data.replaceAll("\n", "\r\n"),
    fileCR ? "old\r\n" : "old\n", ["/work/target"], fileCR ? "new\r\n" : "new\n");
}
for (const sequence of [["normal", "context"], ["context", "unified"], ["unified", "normal"], ["context", "normal", "unified"]] as const) {
  const input = sequence.map((format, index) => formats[format].replace("old\n", `value${index}\n`)
    .replace("new\n", `value${index + 1}\n`)).join("");
  await compare(`mixed/${sequence.join("/")}`, input, "value0\n", ["/work/target"], `value${sequence.length}\n`);
}
const deletions = {
  normal: "1d0\n< old\n",
  context: "*** target\n--- target\n***************\n*** 1 ****\n- old\n--- 0 ----\n",
  unified: "--- target\n+++ target\n@@ -1 +0,0 @@\n-old\n",
};
for (const [format, input] of Object.entries(deletions)) for (const flag of ["-E", "--remove-empty-files"]) {
  await compare(`${format}/${flag}`, input, "old\n", [flag, "/work/target"], undefined);
  await compare(`${format}/${flag}/dry-run`, input, "old\n", [flag, "--dry-run", "/work/target"], "old\n");
}
for (const format of ["context", "unified"] as const) {
  const input = format === "context" ? deletions[format].replace("--- target", "--- /dev/null")
    : deletions[format].replace("+++ target", "+++ /dev/null");
  for (const target of [[], ["/work/target"]]) for (const initial of [undefined, ""]) {
    await compare(`${format}/null-reverse/${target.length ? "explicit" : "auto"}/${initial === undefined ? "missing" : "empty"}`,
      input, initial, ["-R", ...target], "old\n");
  }
}
console.log(JSON.stringify({ version: version.stdout.split("\n")[0], binary,
  binarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"),
  assertions: "exit status and exact target bytes/existence; diagnostics recorded, not compared", total: results.length, results }, null, 2));
