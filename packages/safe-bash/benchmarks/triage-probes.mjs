import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const input = JSON.parse(await readFile(new URL("./reports/full-snapshot-triage.json", import.meta.url), "utf8"));
const root = input.snapshot.directory;
const load = path => import(pathToFileURL(join(root, path)).href);
const { memory, replacement, instrument, invoke, snapshot, cwd } = await load("tests/commands/diff-patch-stress/safety/helpers.ts");
const { Shell, diffPatchCommands } = await load("src/index.ts");
const probes = [];
for (const [first, second, args] of [["target", "./target", []], ["dir/target", "dir/./target", []], ["a/target", "b/target", ["-p1"]], ["a/./target", "b/target", ["-p1"]]]) {
  const fs = await memory({ target: "old\n", "dir/target": "old\n" });
  const before = await snapshot(fs);
  const observed = instrument(fs);
  const result = await invoke(observed.fs, "patch", { args, input: replacement(first) + replacement(second) });
  probes.push({ name: "contradictory duplicate", first, second, args, result, mutations: observed.mutations(), unchanged: isDeepStrictEqual(await snapshot(fs), before) });
}
for (const args of [[], ["-p1"], ["target"], ["--dry-run"]]) {
  const fs = await memory({ first: "old\n", target: "old\n", sentinel: "untouched\n" });
  const before = await snapshot(fs);
  const observed = instrument(fs);
  const input = (args.includes("target") ? "" : replacement("first")) + replacement().replace("+++ target", "+++ /sandbox/work/target");
  const result = await invoke(observed.fs, "patch", { args, input });
  probes.push({ name: "absolute header versus explicit operand", args, result, mutations: observed.mutations(), unchanged: isDeepStrictEqual(await snapshot(fs), before), target: Buffer.from(await fs.readFile(`${cwd}/target`)).toString() });
}
for (const format of ["", "-u "]) {
  const name = "café $(not-a-command);target";
  const fs = await memory({ old: "old\n", next: "new\n", [name]: "old\n", sentinel: "sentinel\n" });
  const observed = instrument(fs, { streaming: true });
  const shell = new Shell({ fs: observed.fs, cwd }).use(diffPatchCommands());
  const source = `diff ${format}--label 'a/${name}' --label 'b/${name}' old next | patch -p1`;
  try {
    const result = await shell.exec(source);
    probes.push({ name: "pipeline format control", source, result, mutations: observed.mutations(), target: Buffer.from(await fs.readFile(`${cwd}/${name}`)).toString(), sentinel: Buffer.from(await fs.readFile(`${cwd}/sentinel`)).toString() });
  } finally { await shell.dispose(); }
}
const nativeIdentities = [];
for (const binary of ["/usr/bin/patch", "/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch"]) {
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 3000 });
  nativeIdentities.push({ binary, version: version.stdout.split("\n")[0], sha256: createHash("sha256").update(await readFile(binary)).digest("hex") });
  for (const fixture of [
    { name: "asymmetric fuzz", before: "old\nactual\n", args: ["-F1"], input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n-old\n+new\n expected\n" },
    { name: "displaced boundary calibration", before: "prefix\nhead\nold\ntail\n", args: ["-F0"], input: "--- target\n+++ target\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n" },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "safe-bash-triage-native-"));
    await writeFile(join(directory, "target"), fixture.before);
    const native = spawnSync(binary, ["-f", "-p0", ...fixture.args], { cwd: directory, input: fixture.input, encoding: "utf8", timeout: 3000, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" } });
    const fs = await memory({ target: fixture.before });
    const result = await invoke(fs, "patch", { args: fixture.args, input: fixture.input });
    probes.push({ name: fixture.name, fixture, native: { binary, directory, exitCode: native.status, stdout: native.stdout, stderr: native.stderr, target: await readFile(join(directory, "target"), "utf8") }, virtual: { result, target: Buffer.from(await fs.readFile(`${cwd}/target`)).toString() } });
  }
}
const report = { snapshot: input.snapshot, nativeIdentities, probes, expectationsChanged: false, scope: "Diagnostic controls; no existing test expectations or implementation modified" };
await writeFile(new URL("./reports/full-snapshot-triage-probes.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
for (const probe of probes) console.log(JSON.stringify(probe));
