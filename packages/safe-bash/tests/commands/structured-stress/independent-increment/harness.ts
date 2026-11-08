import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createStructuredCommands, structuredCommands, type StructuredCommandsOptions } from "../../../../src/commands/structured/index.js";
import { type ByteSource, type CommandContext } from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/index.js";

export interface BytesResult {
  status: number;
  stdoutHex: string;
  stderrHex: string;
}
export interface Vector {
  id: string;
  category: string;
  argv?: string[];
  inputHex: string;
  inputSha256: string;
  transport?: string;
  files?: Record<string, string>;
  stages?: { argv: string[]; inputHex: string; expected: BytesResult }[];
  expected: BytesResult & { stdoutSha256: string; stderrSha256: string };
}
export const vectorBytes = readFileSync(new URL("./native-vectors.json", import.meta.url));
export const vectorHash = "924634ea7933a6b14be1295f65cd0f68485133975961572acab41fc307595a66";
export const vectors = (JSON.parse(vectorBytes.toString()) as { cases: Vector[] }).cases;
export const supplementBytes = readFileSync(new URL("./supplement-vectors.json", import.meta.url));
export const supplementHash = "3989c0678c2e87a6efff2bee562438fc0d03dfdbf167c2329cfebf296e3f4ba2";
export const supplementVectors = (JSON.parse(supplementBytes.toString()) as { cases: Vector[] }).cases;
export const allVectors = [...vectors, ...supplementVectors];
export const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function expectedBytes(vector: Vector): BytesResult {
  const { status, stdoutHex, stderrHex } = vector.expected;
  return { status, stdoutHex, stderrHex };
}

export async function* bytesSource(input: Uint8Array, size = input.length || 1): ByteSource {
  for (let offset = 0; offset < input.length; offset += size) yield input.subarray(offset, offset + size);
}

export async function executeBytes(
  argv: readonly string[],
  input: ByteSource | Uint8Array,
  options: StructuredCommandsOptions = {},
  overrides: Partial<CommandContext> = {},
): Promise<BytesResult> {
  const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  const sizes = { stdout: 0, stderr: 0 };
  const sink = (name: keyof typeof chunks) => ({ async write(chunk: Uint8Array) {
    sizes[name] += chunk.length;
    assert.ok(sizes[name] <= 65536, `${name} independent harness cap`);
    chunks[name].push(Buffer.from(chunk));
  } });
  const context: CommandContext = {
    command: "jq", args: argv, stdin: input instanceof Uint8Array ? bytesSource(input) : input,
    stdinIsDefault: false, stdout: sink("stdout"), stderr: sink("stderr"),
    fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: AbortSignal.timeout(1500), ...overrides,
  };
  const result = await createStructuredCommands({ ...options, limits: {
    maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000, ...options.limits,
  } })[0]!.execute(context);
  return { status: result.exitCode, stdoutHex: Buffer.concat(chunks.stdout).toString("hex"), stderrHex: Buffer.concat(chunks.stderr).toString("hex") };
}

export async function executeVector(vector: Vector): Promise<BytesResult> {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(vector.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  const input = Buffer.from(vector.inputHex, "hex");
  if (!vector.stages) return executeBytes(vector.argv!, bytesSource(input, vector.transport === "bytewise" ? 1 : input.length || 1), {}, { fs });
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const script = vector.stages.map(stage => ["jq", ...stage.argv.map(quote)].join(" ")).join(" | ");
  const shell = new Shell({ fs, limits: { pipeHighWaterMark: 1 } }).use(structuredCommands({ limits: { maxOutputBytes: 65536, maxResults: 4096, maxSteps: 100000 } }));
  const result = await shell.exec(script, { stdin: input, signal: AbortSignal.timeout(1500) });
  return { status: result.exitCode, stdoutHex: Buffer.from(result.stdout).toString("hex"), stderrHex: Buffer.from(result.stderr).toString("hex") };
}
