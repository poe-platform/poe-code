import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contents, execute, setup, target } from "./helpers.js";
import { decoys, vectors } from "./vectors.js";
import { oraclePath } from "../gnu-target/oracle.js";

const binary = oraclePath("patch");
const expectedSha256 = "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00";
const binarySha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
assert.equal(binarySha256, expectedSha256, "pinned oracle executable changed");
const version = spawnSync(binary, ["--version"], { encoding: "utf8", shell: false, timeout: 3000, maxBuffer: 65_536 });
assert.equal(version.status, 0);
assert.match(version.stdout, /^GNU patch 2\.8\n/u);
const results = [];
async function entries(path: string): Promise<string[] | null> {
  try { return (await readdir(path)).sort(); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return null; throw error; }
}
for (const vector of vectors.filter(item => item.native)) {
  const root = await mkdtemp(join(tmpdir(), "safe-bash-diff-empty-native-"));
  try {
    const work = join(root, "work");
    const authorized = join(root, "authorized");
    await mkdir(work);
    await mkdir(authorized);
    const nativeTarget = vector.args.includes("/authorized/target") ? join(authorized, "target") : join(work, "target");
    for (const [name, data] of Object.entries(decoys)) await writeFile(join(work, name), data, { flag: "wx" });
    if (vector.initial !== null) await writeFile(nativeTarget, vector.initial, { flag: "wx" });
    const args = ["--batch", "--no-backup-if-mismatch", ...vector.args.map(arg => arg === "/authorized/target" ? nativeTarget : arg)];
    assert(Buffer.byteLength(vector.input) < 65_536);
    const native = spawnSync(binary, args, { cwd: work, input: vector.input, encoding: "utf8", shell: false,
      timeout: 3000, maxBuffer: 65_536, killSignal: "SIGKILL",
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: root, TMPDIR: root, PATCH_GET: "0" } });
    if (native.error) throw native.error;
    assert.equal(native.signal, null);
    let nativeBytes: string | null = null;
    try { nativeBytes = await readFile(nativeTarget, "utf8"); }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
    for (const [name, data] of Object.entries(decoys)) assert.equal(await readFile(join(work, name), "utf8"), data);
    const fs = await setup(vector);
    const virtual = await execute(fs, vector.args, vector.input);
    const virtualBytes = await contents(fs, target(vector));
    results.push({ name: vector.name, args: args.map(arg => arg.replaceAll(root, "<isolated-root>")), input: vector.input,
      initial: vector.initial, expected: { status: vector.status, bytes: vector.expected },
      native: { status: native.status, bytes: nativeBytes, stdout: native.stdout.replaceAll(root, "<isolated-root>"), stderr: native.stderr.replaceAll(root, "<isolated-root>"),
        workEntries: await entries(work), authorizedEntries: await entries(authorized) },
      virtual: { status: virtual.exitCode, bytes: virtualBytes, stdout: virtual.stdout, stderr: virtual.stderr },
      sameStatusAndTarget: native.status === virtual.exitCode && nativeBytes === virtualBytes,
      nativeMatchesIndependentExpectation: native.status === vector.status && nativeBytes === vector.expected });
  } finally { await rm(root, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ frozenSource: "6e1240ef82679996c2a6ba9a3566ec6a38f6e5a9", binary, binarySha256,
  version: version.stdout.split("\n")[0], execution: "literal argv, shell:false, isolated temporary cwd, 3000 ms, 65536-byte output/input bounds; no host fallback for virtual execution",
  comparison: "exit status and exact target bytes/existence; diagnostics and native auxiliary files recorded, not equated; all three decoys checked unchanged",
  total: results.length, matching: results.filter(result => result.sameStatusAndTarget).length,
  nativeExpectationMatches: results.filter(result => result.nativeMatchesIndependentExpectation).length, results }, null, 2));
if (results.some(result => !result.sameStatusAndTarget || !result.nativeMatchesIndependentExpectation)) process.exitCode = 1;
