import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Shell, agentCommands, createMemoryFileSystem } from "../../../src/index.js";
import { type StreamFormatCommandsOptions } from "../../../src/commands/stream-format/index.js";
import { nativeGnuBinding, verifyNativeExecutable, type NativeGnuOptions } from "../../native-profile.js";

export function shell(options: StreamFormatCommandsOptions = {}, env: Record<string, string> = { LC_ALL: "C" }): Shell {
  const { replace, ...streamFormat } = options;
  return new Shell({ fs: createMemoryFileSystem(), env }).use(agentCommands({ streamFormat, ...(replace === undefined ? {} : { replace }) }));
}

export const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
export const nativeRoot = "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/";
export interface NativeCase { readonly args: readonly string[]; readonly input?: string | Uint8Array; readonly locale?: string; readonly failure?: boolean }

export function nativePath(name: string, options: NativeGnuOptions = {}): string {
  if (name === "rev") return "/usr/bin/rev";
  assert(name === "unexpand" || name === "nl" || name === "seq", "unrecognized native stream command");
  const binding = nativeGnuBinding(name, options);
  if (!binding) return nativeRoot + name;
  verifyNativeExecutable(binding, binding.path, options);
  return binding.path;
}

export function native(name: string, fixture: NativeCase): { exitCode: number | null; stdout: Buffer; stderr: Buffer } {
  const result = spawnSync(nativePath(name), [...fixture.args], {
    input: fixture.input ?? "", env: fixture.locale === "" ? {} : { LC_ALL: fixture.locale ?? "C" }, timeout: 5000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

export async function compare(name: string, fixture: NativeCase): Promise<void> {
  const reference = native(name, fixture);
  const instance = shell({}, fixture.locale === "" ? {} : { LC_ALL: fixture.locale ?? "C" });
  try {
    const actual = await instance.exec([name, ...fixture.args.map(quote)].join(" "), { stdin: fixture.input ?? "" });
    assert.equal(actual.exitCode, reference.exitCode);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), reference.stdout);
    if (fixture.failure) {
      assert.notEqual(reference.exitCode, 0);
      assert.ok(reference.stderr.length);
      assert.ok(actual.stderr.length);
    } else assert.deepEqual(Buffer.from(actual.stderrBytes), reference.stderr);
  } finally { await instance.dispose(); }
}
