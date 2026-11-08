import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const profiles = [
  { name: "primary-5.3", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", sha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { name: "historical-3.2", executable: "/bin/bash", sha256: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
] as const;
const fixtures = [
  { name: "argv", body: 'printf "[%s][%s]\\n" "$0" "$#"; printf "<%s>\\n" "$@"', args: ["", "two words", "*", "$(bad)", ";", "é"], input: "" },
  { name: "empty-argv", body: 'printf "[%s][%s]\\n" "$0" "$#"; for argument; do printf "<%s>\\n" "$argument"; done', args: [], input: "" },
  { name: "shift", body: 'shift; printf "[%s][%s]\\n" "$0" "$#"; printf "<%s>\\n" "$@"', args: ["first", "", "last"], input: "" },
  { name: "empty-script", body: "", args: [], input: "" },
  { name: "exit", body: "exit 23; printf unreachable >marker", args: [], input: "" },
  { name: "negative-exit", body: "exit -1", args: [], input: "" },
  { name: "wrapped-exit", body: "exit 258", args: [], input: "" },
  { name: "last-status", body: "true\nfalse\n", args: [], input: "" },
  { name: "initial-status-env", body: 'printf "[%s][%s][%s]\\n" "$?" "$PUBLIC" "${PRIVATE-unset}"', args: [], input: "" },
  { name: "line-diagnostic", body: "# line one\n\nmissing\nexit 7", args: [], input: "" },
  { name: "stdin", body: 'read -r first; printf "[%s]\\n" "$first"; cat', args: [], input: "first\nremainder\n" },
  { name: "binary-stdin", body: "cat", args: [], input: Buffer.from([0, 255, 128, 10]) },
] as const;
const hash = (path: string | URL): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const sourcePaths = ["../../src/shell/runtime.ts", "../../src/shell/shell.ts", "../../src/shell/parser.ts", "../../src/shell/input.ts", "../../src/commands/index.ts", "./script-entrypoint-native.ts"];
const hashes = (): Record<string, string> => Object.fromEntries(sourcePaths.map(path => [path, hash(new URL(path, import.meta.url))]));
const before = hashes();
assert.ok(import.meta.resolve("../../src/shell/runtime.js").endsWith("/src/shell/runtime.ts"));
assert.ok(import.meta.resolve("../../src/shell/index.js").endsWith("/src/shell/index.ts"));
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const records = [];

for (const profile of profiles) {
  assert.equal(hash(profile.executable), profile.sha256);
  const versionResult = spawnSync(profile.executable, ["--noprofile", "--norc", "--version"], { encoding: "utf8", timeout: 2000, maxBuffer: 262144, env: { LC_ALL: "C" } });
  assert.equal(versionResult.status, 0, versionResult.stderr);
  const version = versionResult.stdout.split("\n")[0];
  const comparisons = [];
  for (const fixture of fixtures) {
    const directory = mkdtempSync(join(process.cwd(), ".script-entrypoint-native-"));
    try {
      writeFileSync(join(directory, "program"), fixture.body, { mode: 0o600 });
      const native = spawnSync(profile.executable, ["--noprofile", "--norc", "--", "program", ...fixture.args], {
        cwd: directory, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: directory, PUBLIC: "exported" },
        input: fixture.input, timeout: 2000, maxBuffer: 262144,
      });
      assert.equal(native.error, undefined, native.error?.message);
      assert.equal(native.signal, null);
      const nativeResult = { stdoutBase64: native.stdout.toString("base64"), stderrBase64: native.stderr.toString("base64"), exitCode: native.status, files: Object.fromEntries(readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name)).toString("base64")])) };
      const fs = new MemoryFileSystem();
      await fs.writeFile("/program", new TextEncoder().encode(fixture.body), { mode: 0o600 });
      const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PUBLIC: "exported" } });
      const virtual = await shell.exec(`bash -- program ${fixture.args.map(quote).join(" ")}`, { stdin: fixture.input, signal: AbortSignal.timeout(2000) });
      const virtualResult = { stdoutBase64: Buffer.from(virtual.stdoutBytes).toString("base64"), stderrBase64: Buffer.from(virtual.stderrBytes).toString("base64"), exitCode: virtual.exitCode, files: Object.fromEntries(await Promise.all((await fs.readdir("/")).sort((left, right) => left.name.localeCompare(right.name)).map(async entry => [entry.name, Buffer.from(await fs.readFile(`/${entry.name}`)).toString("base64")]))) };
      comparisons.push({ name: fixture.name, native: nativeResult, virtual: virtualResult });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  assert.equal(hash(profile.executable), profile.sha256);
  records.push({ ...profile, version, comparisons });
}
assert.deepEqual(hashes(), before, "source changed during native checkpoint");
console.log(JSON.stringify({ sourceHashes: before, module: import.meta.url, runtimeResolution: import.meta.resolve("../../src/shell/runtime.js"), timeoutMs: 2000, records }, null, 2));
for (const profile of records) for (const record of profile.comparisons) assert.deepEqual(record.virtual, record.native, `${profile.name}: ${record.name}`);
