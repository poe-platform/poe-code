import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inspect, repository, hash } from "./inspect.mjs";
import { account } from "../account.mjs";
import { supervise } from "../supervise.mjs";

const revision = "b494675c34dc289f4ad4b10a9201e1211eb0a7d8";
const output = resolve(process.argv[2] ?? ""); assert.ok(process.argv[2] && !existsSync(output)); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync("/tmp/full-gate-b494-diagnose-")), source = join(temporary, "source"); mkdirSync(source);
const report = { revision, startedAt: new Date().toISOString(), scope: "fresh frozen focused diagnostics after invalidated whole capture; never subtract these results from that capture", phases: [], native: [], status: "running", temporary };
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const nativeBin = join(temporary, "native-bin"); mkdirSync(nativeBin);
const environment = { PATH: `${nativeBin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(temporary, "home"), TMPDIR: join(temporary, "tmp"),
  TSX_DISABLE_CACHE: "1", TZ: "UTC", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", NODE_OPTIONS: "", NODE_PATH: "" };
mkdirSync(environment.HOME); mkdirSync(environment.TMPDIR);
const run = async (label, args, timeoutMs = 180000) => {
  const result = await supervise(process.execPath, args, { cwd: source, env: environment, timeoutMs,
    stdout: join(output, `${label}.stdout.log`), stderr: join(output, `${label}.stderr.log`), observeSockets: true });
  result.label = label;
  if (label.endsWith("tests")) result.accounting = account(readFileSync(join(output, `${label}.stdout.log`), "utf8"));
  report.phases.push(result); save(`${label}.json`, result); save("report.json", report); return result;
};

try {
  const discovery = inspect(revision); report.trackedFiles = discovery.trackedFiles;
  execFileSync("git", ["--no-replace-objects", "archive", "--format=tar", `--output=${join(temporary, "source.tar")}`, revision], { cwd: repository, timeout: 180000 });
  execFileSync("/usr/bin/tar", ["-xf", join(temporary, "source.tar"), "-C", source], { timeout: 180000 });
  cpSync(join(repository, "node_modules"), join(source, "node_modules"), { recursive: true, dereference: true });
  report.sourceHashes = discovery.tree.filter(entry => entry.path.startsWith("src/")).map(entry => ({ path: entry.path, sha256: hash(readFileSync(join(source, entry.path))) }));
  const compiler = join(source, "node_modules/typescript/bin/tsc");
  const build = await run("production-build", [compiler, "-p", "tsconfig.build.json"]); assert.equal(build.status, 0); assert.equal(build.clean, true);
  await run("global-types-after-build", [compiler, "--noEmit"]);

  const rgOrigin = "/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg";
  const rgHash = "4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f";
  assert.equal(hash(readFileSync(rgOrigin)), rgHash);
  cpSync(rgOrigin, join(nativeBin, "rg"));
  assert.equal(hash(readFileSync(join(nativeBin, "rg"))), rgHash);
  report.native.push({ name: "rg", origin: rgOrigin, sha256: rgHash, identity: execFileSync(join(nativeBin, "rg"), ["--version"], { encoding: "utf8" }) });

  const frozen = JSON.parse(readFileSync(join(source, "tests/commands/stream-format/evidence/freeze-native.json")));
  for (const [name, pin] of Object.entries(frozen.references)) {
    const origin = pin.path.startsWith("/") ? pin.path : join(repository, pin.path);
    assert.equal(hash(readFileSync(origin)), pin.sha256, name);
    if (!pin.path.startsWith("/")) {
      const target = join(source, pin.path); mkdirSync(dirname(target), { recursive: true }); cpSync(origin, target);
      assert.equal(hash(readFileSync(target)), pin.sha256); assert.ok(lstatSync(target).mode & 0o111);
    }
    report.native.push({ name, origin, path: pin.path, sha256: pin.sha256, identity: pin.identity });
  }
  const nativeTests = ["tests/commands/stream-format-author-stress/native-streams.test.ts", "tests/commands/stream-format-author-stress/seq-format.test.ts",
    ...["nl", "seq-diagnostic", "seq", "unexpand"].map(name => `tests/commands/stream-format/${name}.test.ts`)];
  await run("missing-native-focused-tests", ["--import", "tsx", "--test", ...nativeTests]);
  await run("search-differential-tests", ["--import", "tsx", "--test", "tests/commands/search-stress/differential.test.ts"], 120000);
  await run("remaining-focused-tests", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/commands/search-stress/safety.test.ts",
    "tests/shell/remote-close.test.ts", "tests/stress/adapters/remote-safe-workflows.test.ts"], 120000);

  const artifact = "tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/artifacts/direct-registered-curl-buffer-307-replay.json";
  const before = readFileSync(join(source, artifact)); writeFileSync(join(output, "artifact-before.json"), before);
  const writer = "tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/direct-curl.test.ts";
  report.writer = { path: writer, sha256: hash(readFileSync(join(source, writer))), expectedSha256: hash(execFileSync("git", ["show", `${revision}:${writer}`], { cwd: repository })) };
  assert.equal(report.writer.sha256, report.writer.expectedSha256);
  await run("tracked-artifact-reproducer-tests", ["--import", "tsx", "--test", writer], 30000);
  const after = readFileSync(join(source, artifact)); writeFileSync(join(output, "artifact-after.json"), after);
  report.artifactMutation = { path: artifact, beforeSha256: hash(before), afterSha256: hash(after), changed: !before.equals(after),
    scope: "intentional unchanged single-file reproduction in isolated copy, performed last; not an immutable passing gate" };
  assert.equal(report.artifactMutation.changed, true);
  report.productChanges = report.sourceHashes.filter(entry => hash(readFileSync(join(source, entry.path))) !== entry.sha256);
  assert.deepEqual(report.productChanges, []); report.status = "focused-diagnostics-captured";
} catch (error) { report.status = "infrastructure-failed"; report.error = error.stack; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); save("report.json", report);
  console.log(JSON.stringify({ status: report.status, error: report.error, phases: report.phases.map(row => ({ label: row.label, status: row.status, counts: row.accounting?.counts })), mutation: report.artifactMutation, cleaned: report.cleaned }));
}
