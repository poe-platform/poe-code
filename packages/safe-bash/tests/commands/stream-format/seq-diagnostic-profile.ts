import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { currentNativeHost, qualifyNativeProfile, type NativeHost } from "../../native-profile.js";

export const seqDiagnosticFormats: readonly string[] = Object.freeze([
  "%f %f", "%g %e", "", "literal", "%%", "%%f", "%", "%%%", "%s", "%%%s", "%f %", "%f %s", "%f %% %g", "%f %%%", "%f %%", "%%%f%%",
]);
const extraDirectiveFormats = new Set(["%f %f", "%g %e", "%f %", "%f %s", "%f %% %g", "%f %%%"]);
export const isExtraSeqDiagnostic = (format: string): boolean => extraDirectiveFormats.has(format);
export const seqDiagnosticOraclePath = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/seq", import.meta.url));
export const seqDiagnosticOracleHash = "ffc2f2585818b4185924d73e839c93c44b9115f6e91a28b340760e4a0533f70f";
export const seqDiagnosticEvidencePath = fileURLToPath(new URL("./evidence/seq-diagnostic-initial.json", import.meta.url));
const evidenceHash = "328ece09cbb389ed2a95e42007b63e591826f7d1a8797bd2c38c414407a11ea6";
const historicalProfile = Object.freeze({
  id: "seq-diagnostic-gnu9.7-darwin-arm64-25.4.0",
  evidence: "tests/commands/stream-format/evidence/seq-diagnostic-initial.json; seq-diagnostic.test.ts original qualifier",
  host: Object.freeze({ platform: "darwin", arch: "arm64", release: "25.4.0" }),
});

interface Observation { readonly exitCode: number; readonly stdoutHex: string; readonly stderr: string }
interface Fixture { readonly args: readonly string[]; readonly native: Observation; readonly source: Observation }
interface NativeResult { readonly status: number | null; readonly signal: string | null; readonly error?: unknown; readonly stdout: Uint8Array; readonly stderr: Uint8Array }
interface NativeOptions { readonly env: { readonly LC_ALL: string }; readonly input: string; readonly shell: false; readonly timeout: number; readonly maxBuffer: number }
interface Dependencies {
  readonly fileSystem: typeof fs;
  readonly host: () => NativeHost;
  readonly digest: (bytes: Uint8Array) => string;
  readonly spawn: (path: string, args: readonly string[], options: NativeOptions) => NativeResult;
}

export function createSeqDiagnosticOracle(overrides: Partial<Dependencies> = {}) {
  const fileSystem = overrides.fileSystem ?? fs;
  const host = overrides.host ?? currentNativeHost;
  const digest = overrides.digest ?? ((bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"));
  const spawn = overrides.spawn ?? spawnSync;

  function readPinned(path: string, maximum: number, expectedHash: string, executable = false): Buffer {
    const before = fileSystem.lstatSync(path);
    assert(before.isFile() && !before.isSymbolicLink(), "seq diagnostic input must be a regular file");
    assert(before.size > 0 && before.size <= maximum, "seq diagnostic input size bound");
    if (executable) assert.notEqual(before.mode & 0o111, 0, "seq diagnostic native tool must be executable");
    else assert.equal(before.size, maximum, "seq diagnostic captured fixture size");
    const descriptor = fileSystem.openSync(path, fileSystem.constants.O_RDONLY | fileSystem.constants.O_NOFOLLOW);
    let failed = false, failure: unknown;
    let bytes: Buffer | undefined;
    try {
      const opened = fileSystem.fstatSync(descriptor);
      assert(opened.isFile());
      assert.deepEqual([opened.dev, opened.ino, opened.size, opened.mode], [before.dev, before.ino, before.size, before.mode], "seq diagnostic input changed before read");
      const buffer = Buffer.alloc(opened.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const count = fileSystem.readSync(descriptor, buffer, offset, buffer.length - offset, null);
        if (count === 0) break;
        offset += count;
      }
      assert.equal(offset, opened.size, "seq diagnostic input changed while reading");
      const after = fileSystem.fstatSync(descriptor);
      assert.deepEqual([after.dev, after.ino, after.size, after.mode, after.mtimeMs, after.ctimeMs], [opened.dev, opened.ino, opened.size, opened.mode, opened.mtimeMs, opened.ctimeMs]);
      bytes = buffer.subarray(0, offset);
      assert.equal(digest(bytes), expectedHash, "seq diagnostic input SHA-256");
    } catch (error) { failed = true; failure = error; }
    try { fileSystem.closeSync(descriptor); }
    catch (error) { if (failed) throw new AggregateError([failure, error], "seq diagnostic read and close failed"); throw error; }
    if (failed) throw failure;
    return bytes!;
  }

  function observation(value: unknown): Observation {
    assert(value !== null && typeof value === "object");
    const record = value as Record<string, unknown>;
    assert(Number.isInteger(record.exitCode) && Number(record.exitCode) >= 0 && Number(record.exitCode) <= 255);
    assert(typeof record.stdoutHex === "string" && /^(?:[0-9a-f]{2})*$/u.test(record.stdoutHex));
    assert.equal(typeof record.stderr, "string");
    return Object.freeze({ exitCode: record.exitCode as number, stdoutHex: record.stdoutHex, stderr: record.stderr as string });
  }

  function fixtures(): readonly Fixture[] {
    const bytes = readPinned(seqDiagnosticEvidencePath, 7752, evidenceHash);
    const captured = JSON.parse(bytes.toString("utf8")) as { cases?: unknown };
    assert(Array.isArray(captured.cases));
    assert.equal(captured.cases.length, seqDiagnosticFormats.length);
    return Object.freeze(captured.cases.map((value: unknown, ordinal: number) => {
      assert(value !== null && typeof value === "object");
      const row = value as Record<string, unknown>;
      const args = ["-f", seqDiagnosticFormats[ordinal]!, "3"];
      assert.deepEqual(row.args, args, "seq diagnostic captured row order and arguments");
      return Object.freeze({ args: Object.freeze(args), native: observation(row.native), source: observation(row.source) });
    }));
  }

  function invoke(args: readonly string[]): Readonly<{ observation: Observation; stderrBytes: Buffer }> {
    readPinned(seqDiagnosticOraclePath, 16 * 1024 * 1024, seqDiagnosticOracleHash, true);
    const result = spawn(seqDiagnosticOraclePath, [...args], { env: { LC_ALL: "C" }, input: "", shell: false, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error !== undefined && result.error !== null) throw result.error;
    assert.equal(result.signal, null, "seq diagnostic native signal");
    assert(result.status !== null && Number.isInteger(result.status) && result.status >= 0 && result.status <= 255, "seq diagnostic native exit status");
    assert(result.stdout instanceof Uint8Array && result.stderr instanceof Uint8Array);
    assert(result.stdout.byteLength <= 16 * 1024 * 1024 && result.stderr.byteLength <= 16 * 1024 * 1024);
    const stderrBytes = Buffer.from(result.stderr);
    const captured = Object.freeze({ observation: Object.freeze({ exitCode: result.status, stdoutHex: Buffer.from(result.stdout).toString("hex"), stderr: stderrBytes.toString() }), stderrBytes });
    readPinned(seqDiagnosticOraclePath, 16 * 1024 * 1024, seqDiagnosticOracleHash, true);
    return captured;
  }

  function admit() {
    const version = invoke(["--version"]).observation;
    assert.equal(version.exitCode, 0, "seq diagnostic version exit status");
    assert.match(Buffer.from(version.stdoutHex, "hex").toString(), /^seq \(GNU coreutils\) 9\.7\n/u);
    return Object.freeze({ path: seqDiagnosticOraclePath, sha256: seqDiagnosticOracleHash });
  }

  return Object.freeze({
    fixtures,
    qualify: () => qualifyNativeProfile(historicalProfile, host(), admit),
    native: async (args: readonly string[]) => {
      assert(args.length === 3 && args[0] === "-f" && seqDiagnosticFormats.includes(args[1]!) && args[2] === "3", "seq diagnostic native row arguments");
      const ownedArgs = [...args];
      return qualifyNativeProfile(historicalProfile, host(), () => Object.freeze({ ...admit(), ...invoke(ownedArgs) }));
    },
  });
}

export const seqDiagnosticOracle = createSeqDiagnosticOracle();

interface CandidateResult { readonly exitCode: number; readonly stdoutBytes: Uint8Array; readonly stderrBytes: Uint8Array; readonly stderr: string }
interface Candidate { exec(command: string): Promise<CandidateResult>; dispose(): Promise<void> }

export async function observeSeqDiagnosticCandidate(instance: Candidate, command: string): Promise<CandidateResult> {
  let failed = false, failure: unknown;
  let owned: CandidateResult | undefined;
  try {
    const result = await instance.exec(command);
    owned = Object.freeze({ exitCode: result.exitCode, stdoutBytes: Buffer.from(result.stdoutBytes), stderrBytes: Buffer.from(result.stderrBytes), stderr: result.stderr });
  } catch (error) { failed = true; failure = error; }
  try { await instance.dispose(); }
  catch (error) { if (failed) throw new AggregateError([failure, error], "seq diagnostic candidate and disposal failed"); throw error; }
  if (failed) throw failure;
  return owned!;
}
