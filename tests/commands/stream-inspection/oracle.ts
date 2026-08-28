import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCases, appleDifferenceCases } from "./cases.js";
import { type Fixture } from "./helpers.js";

export const defaultGnu = "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src";
const expectedGnu: Readonly<Record<string, string>> = {
  tac: "5fad8c461c2583b9fc9052b943a87eba6dba6b271ff51d811e5cdc21e722ad41",
  expand: "158dccaca888f3187291f4f4ede9b3715ccee15e8e441f82030dc09d25a2648b",
  fold: "8cfe2de684b57136dcb7040d529289b610f4f15a4f8696cded679d56a5361559",
};

export function identity(executable: string) {
  const resolved = realpathSync(executable);
  const version = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 5000, env: { LC_ALL: "C", PATH: "/usr/bin:/bin" } });
  return { executable, resolved, sha256: createHash("sha256").update(readFileSync(resolved)).digest("hex"), version: version.stdout, versionStderr: version.stderr, versionStatus: version.status };
}

export function capture(specimen: Fixture, executable: string, argv0 = executable) {
  const folder = mkdtempSync(fileURLToPath(new URL("./author-native-", import.meta.url)));
  let temporary: string | undefined;
  try {
    const base = realpathSync(tmpdir());
    if (process.env.FULL_GATE_ROOT) {
      const owned = realpathSync(process.env.FULL_GATE_ROOT);
      assert(base === owned || base.startsWith(owned + sep), "native scratch is outside the admitted gate root");
    }
    temporary = mkdtempSync(join(base, "safe-bash-stream-scratch-"));
    for (const [name, hex] of Object.entries(specimen.files ?? {})) writeFileSync(join(folder, name), Buffer.from(hex, "hex"));
    const result = spawnSync(executable, specimen.args, { argv0, cwd: folder, input: Buffer.from(specimen.stdinHex, "hex"), timeout: 5000, maxBuffer: 8 * 1024 * 1024, env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/usr/bin:/bin", TMPDIR: temporary } });
    if (result.error) throw result.error;
    return { id: specimen.id, command: specimen.command, fixtureSha256: createHash("sha256").update(JSON.stringify(specimen)).digest("hex"), status: result.status, signal: result.signal, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") };
  } finally {
    try { rmSync(folder, { recursive: true }); }
    finally { if (temporary !== undefined) rmSync(temporary, { recursive: true }); }
  }
}

export function captureAll() {
  const directory = process.env.STREAM_GNU_BIN ?? defaultGnu;
  const identities = Object.fromEntries(["tac", "expand", "fold"].map(name => {
    const details = identity(join(directory, name));
    assert.equal(details.sha256, expectedGnu[name]);
    assert.ok(details.version.startsWith(`${name} (GNU coreutils) 9.7`));
    return [name, details];
  }));
  const apple = Object.fromEntries(["expand", "fold", "strings"].map(name => [name, identity(`/usr/bin/${name}`)]));
  const appleStringsTarget = identity("/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/strings");
  return {
    host: { node: process.version, platform: process.platform, arch: process.arch, swVers: execFileSync("/usr/bin/sw_vers", { encoding: "utf8" }) },
    profile: "GNU coreutils9.7 on Darwin LC_ALL=C; Apple strings raw common controls separately, GNU strings unavailable",
    identities, apple, appleStringsTarget,
    observations: nativeCases.map(specimen => ({ ...capture(specimen, specimen.command === "strings" ? "/usr/bin/strings" : join(directory, specimen.command)), oracle: specimen.command === "strings" ? "Apple raw common" : "GNU9.7" })),
    appleDifferences: appleDifferenceCases.map(specimen => capture(specimen, `/usr/bin/${specimen.command}`)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const content = JSON.stringify(captureAll(), null, 2) + "\n";
  const patch = "*** Begin Patch\n*** Add File: tests/commands/stream-inspection/evidence/native-corrected.json\n" + content.split("\n").slice(0, -1).map(line => "+" + line).join("\n") + "\n*** End Patch\n";
  execFileSync("apply_patch", [], { input: patch, stdio: ["pipe", "inherit", "inherit"] });
}
