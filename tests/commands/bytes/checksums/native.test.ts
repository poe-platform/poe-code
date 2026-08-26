import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chunks, encoder, fixture, run } from "./helpers.js";

interface NativeResult { stdout: string; stderr: string; exitCode: number }
interface Oracle { program: string; version: string; gnu: boolean }

function native(program: string, args: readonly string[], input = new Uint8Array(), cwd?: string): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(program, [...args], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024, ...(cwd ? { cwd } : {}), env: { ...process.env, LC_ALL: "C" } }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") { reject(error); return; }
      resolve({ stdout, stderr, exitCode: typeof error?.code === "number" ? error.code : 0 });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

async function discover(name: string): Promise<Oracle | undefined> {
  let fallback: Oracle | undefined;
  for (const program of [...(process.env.BYTE_GNU_COREUTILS_DIR ? [join(process.env.BYTE_GNU_COREUTILS_DIR, name)] : []), `g${name}`, `/opt/homebrew/opt/coreutils/libexec/gnubin/${name}`, name]) {
    try {
      const result = await native(program, ["--version"]);
      const gnu = result.stdout.includes("GNU coreutils");
      const version = result.stdout.split("\n")[0] || `no version flag; ${platform()} ${release()}; ${result.stderr.split("\n")[0]}`;
      if (gnu) return { program, version, gnu };
      fallback ??= { program, version, gnu };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return fallback;
}

for (const name of ["sha256sum", "sha1sum", "md5sum", "cksum"]) {
  test(`${name}: isolated installed native oracle, binary lengths and chunk boundaries`, async context => {
    const oracle = await discover(name);
    if (!oracle) { context.skip(`${name} is not installed on ${platform()} ${release()}`); return; }
    context.diagnostic(`${oracle.program}: ${oracle.version}; platform ${platform()} ${release()}`);
    for (const size of [0, 1, 2, 255, 256, 257, 65535, 65536, 65537, 1024 * 1024 + 1]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 31 + (index >>> 8)) & 255);
      const expected = await native(oracle.program, [], bytes);
      assert.equal(expected.exitCode, 0, expected.stderr);
      const actual = await run(name, [], { stdin: chunks(bytes, 8191) });
      assert.equal(actual.exitCode, expected.exitCode);
      assert.equal(actual.stdout, expected.stdout, `${name}: ${size} bytes`);
    }
  });

  if (name !== "cksum") test(`${name}: isolated GNU manifest and option oracle`, async context => {
    const oracle = await discover(name);
    if (!oracle?.gnu) { context.skip(`GNU coreutils ${name} unavailable; found ${oracle?.version ?? "none"}`); return; }
    context.diagnostic(`${oracle.program}: ${oracle.version}; platform ${platform()} ${release()}`);
    const directory = await mkdtemp(join(tmpdir(), "safe-byte-native-checksums-"));
    const names = ["data", "back\\slash", "new\nline", "return\rname", "é😀", " leading "];
    try {
      const bytes = Uint8Array.of(0, 255, 128, 13, 10, 5);
      const fs = await fixture(Object.fromEntries(names.map(filename => [filename, bytes])));
      for (const filename of names) await writeFile(join(directory, filename), bytes);
      for (const flags of [[], ["-b"], ["-btb", "--text"], ["-z"]]) {
        const expected = await native(oracle.program, [...flags, ...names], undefined, directory);
        const actual = await run(name, [...flags, ...names], { fs });
        assert.deepEqual(actual, expected);
      }
      const generated = await native(oracle.program, names, undefined, directory);
      for (const flags of [[], ["--quiet"], ["--status"], ["--strict"], ["--warn"], ["--quiet", "--status", "--warn"]]) {
        const expected = await native(oracle.program, ["-c", ...flags], encoder.encode(generated.stdout), directory);
        assert.deepEqual(await run(name, ["-c", ...flags], { fs, stdin: generated.stdout }), expected);
      }
      const firstLine = generated.stdout.split("\n")[0]!;
      for (const [manifest, flags] of [
        [firstLine + "\ninvalid\n", []],
        [firstLine + "\ninvalid\n", ["--strict"]],
        [firstLine.replace(/data$/u, "missing") + "\n", ["--ignore-missing"]],
        [firstLine.replace(/data$/u, "missing") + "\n" + firstLine + "\n", ["--ignore-missing"]],
        [firstLine.replace(/^[0-9a-f]/u, "f") + "\n", ["--quiet"]],
      ] as const) {
        const expected = await native(oracle.program, ["-c", ...flags], encoder.encode(manifest), directory);
        const actual = await run(name, ["-c", ...flags], { fs, stdin: manifest });
        assert.equal(actual.exitCode, expected.exitCode);
        assert.equal(actual.stdout, expected.stdout);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
