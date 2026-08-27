import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type } from "node:os";

const own = dirname(fileURLToPath(import.meta.url));
const root = resolve(own, "../../../..");
const snapshot = process.argv[2];
assert.ok(snapshot && resolve(snapshot).startsWith(`${own}/.work-`));
const load = path => import(pathToFileURL(join(snapshot, "dist", path)).href);
const { Shell } = await load("shell/index.js");
const { createMemoryFileSystem } = await load("fs/memory/index.js");
const { exprCommands } = await load("commands/expr/index.js");
const { RegexExecutor } = await load("commands/regex-execution/client.js");
const { exprMatchCeilings } = await load("commands/regex-execution/protocol.js");
const original = JSON.parse(readFileSync(join(own, "../nullable-design-review/capture-final/cases.json"), "utf8"));
const historical = JSON.parse(readFileSync(join(own, "../nullable-design-review/capture-final/summary.json"), "utf8"));
const oracle = join(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr");
const oracleHash = createHash("sha256").update(readFileSync(oracle)).digest("hex");
assert.equal(oracleHash, "e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c");
assert.equal(type(), "Darwin");
const nativeCwd = mkdtempSync(join(own, ".native-"));
const native = argv => {
  assert.ok(argv.length <= 128 && argv.reduce((size, value) => size + Buffer.byteLength(value), 0) <= 4096);
  const observed = spawnSync(oracle, argv, { cwd: nativeCwd, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", LANGUAGE: "C", TZ: "UTC" }, timeout: 2000, maxBuffer: 16384 });
  assert.ifError(observed.error); assert.equal(observed.signal, null); assert.notEqual(observed.status, null);
  return { status: observed.status, stdoutHex: observed.stdout.toString("hex"), stderrHex: observed.stderr.toString("hex") };
};
const shell = new Shell({ fs: createMemoryFileSystem() }).use(exprCommands());
const executor = new RegexExecutor();
const session = executor.open(new AbortController().signal);
const rows = [];
try {
  assert.match(Buffer.from(native(["--version"]).stdoutHex, "hex").toString(), /^expr \(GNU coreutils\) 9\.7\n/u);
  for (const specimen of original) {
    const { argv } = specimen;
    const descriptor = { kind: "expr-match", pattern: Buffer.from(argv.at(-1)), profile: "byte", limits: exprMatchCeilings };
    let internal;
    try { internal = await session.matchExpr(descriptor, Buffer.from(argv[1])); }
    catch (error) { internal = { category: error.category, message: error.message }; }
    const command = ["expr", ...argv].map(argument => `'${argument.replaceAll("'", "'\\''")}'`).join(" ");
    const actual = await shell.exec(command, { env: { LC_ALL: "C" } });
    const cli = { status: actual.exitCode, stdoutHex: Buffer.from(actual.stdout).toString("hex"), stderrHex: Buffer.from(actual.stderr).toString("hex") };
    const expected = native(argv);
    const frozen = historical.find(row => row.id === specimen.id).native;
    assert.deepEqual(expected, { status: frozen.status, stdoutHex: Buffer.from(frozen.stdoutBase64, "base64").toString("hex"), stderrHex: Buffer.from(frozen.stderrBase64, "base64").toString("hex") }, `unchanged frozen native tuple: ${specimen.id}`);
    rows.push({ ...specimen, expected, cli, cliEqual: JSON.stringify(cli) === JSON.stringify(expected), internal });
  }
} finally {
  await session.close(); await executor.dispose(); await shell.dispose();
  rmSync(nativeCwd, { recursive: true, force: true });
  assert.equal(createHash("sha256").update(readFileSync(oracle)).digest("hex"), oracleHash);
}
console.log(JSON.stringify({ oracle, oracleHash, profile: "C on pinned GNU9.7/Darwin", rows, actualCLI: "Shell.exec with expr plugin; not a projection from spans", internal: "separate RegexExecutor request, existing validated byte protocol", cleanup: { sessionClosed: true, executorDisposed: true, shellDisposed: true, nativeCwdRemoved: true } }));
