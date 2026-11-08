import assert from "node:assert/strict";
import { createStructuredCommands, type StructuredCommandsOptions } from "../../../src/commands/structured/index.js";
import { toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

export interface Fixture {
  readonly id: string;
  readonly input: string;
  readonly argv: readonly string[];
  readonly stdout: string;
  readonly status: number;
}

export async function execute(
  argv: readonly string[],
  input: string | Uint8Array | ByteSource = "null",
  options: StructuredCommandsOptions = {},
  overrides: Partial<CommandContext> = {},
) {
  const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  const sizes = { stdout: 0, stderr: 0 };
  const sink = (name: keyof typeof output) => ({ async write(chunk: Uint8Array) {
    sizes[name] += chunk.byteLength;
    assert.ok(sizes[name] <= 128 * 1024, `${name} exceeded independent capture cap`);
    output[name].push(Buffer.from(chunk));
  } });
  const context: CommandContext = {
    command: "jq", args: argv,
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: sink("stdout"), stderr: sink("stderr"),
    fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: AbortSignal.timeout(2000), ...overrides,
  };
  const result = await createStructuredCommands({ ...options, limits: {
    maxOutputBytes: 64 * 1024, maxResults: 4096, maxSteps: 100000, ...options.limits,
  } })[0]!.execute(context);
  return { status: result.exitCode, stdout: Buffer.concat(output.stdout).toString(), stderr: Buffer.concat(output.stderr).toString() };
}

export async function check(fixture: Fixture) {
  const actual = await execute(fixture.argv, fixture.input);
  assert.equal(actual.status, fixture.status, `${fixture.id}: ${actual.stderr}`);
  assert.equal(actual.stdout, fixture.stdout, fixture.id);
  if (fixture.status === 0 || fixture.status === 1 || fixture.status === 4) assert.equal(actual.stderr, "", fixture.id);
  else assert.match(actual.stderr, /^jq: .+\n$/u, fixture.id);
}
