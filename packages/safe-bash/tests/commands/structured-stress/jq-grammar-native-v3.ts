import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface NativeTuple { status: number; stdoutHex: string; stderrHex: string }
interface NativeVector { ids: string[]; argv: string[]; inputHex: string; files: Record<string, string>; expected: NativeTuple }
interface ByteMutant { id: string; expectedHex: string; mutantHex: string }
export const nativeGrammar = JSON.parse(readFileSync(new URL("./jq-grammar-native-v3.json", import.meta.url), "utf8")) as { vectors: NativeVector[]; byteMutants: ByteMutant[] };
const inputKey = (argv: readonly string[], inputHex: string, files: Readonly<Record<string, string>>) => JSON.stringify([argv, inputHex, Object.entries(files).sort(([left], [right]) => left.localeCompare(right))]);
const expectedByInput = new Map<string, NativeTuple>();
for (const vector of nativeGrammar.vectors) {
  const key = inputKey(vector.argv, vector.inputHex, vector.files);
  assert.ok(!expectedByInput.has(key), "duplicate frozen native input");
  expectedByInput.set(key, vector.expected);
}

export function nativeExpected(argv: readonly string[], input: string | Uint8Array, files: Readonly<Record<string, string>> = {}): NativeTuple {
  assert.ok(typeof input === "string" || input instanceof Uint8Array, "explicit actual input required");
  const inputHex = Buffer.from(input).toString("hex");
  const expected = expectedByInput.get(inputKey(argv, inputHex, files));
  assert.ok(expected, "missing frozen native input");
  return expected;
}

export function assertNative(result: { status?: number; exitCode?: number; stdoutBytes: Uint8Array; stderrBytes: Uint8Array }, argv: readonly string[], input: string | Uint8Array, files: Readonly<Record<string, string>> = {}): void {
  assert.ok(result.stdoutBytes instanceof Uint8Array && result.stderrBytes instanceof Uint8Array, "raw captured bytes required");
  assert.deepEqual({ status: result.status ?? result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, nativeExpected(argv, input, files));
}
