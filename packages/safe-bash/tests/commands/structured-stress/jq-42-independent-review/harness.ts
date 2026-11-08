import assert from "node:assert/strict";
import type { ByteSource, CommandContext } from "../../../../src/contracts/index.js";

export interface BytesResult {
  status: number;
  stdoutHex: string;
  stderrHex: string;
}
export interface Stage {
  argv: string[];
  inputHex: string;
  expected: BytesResult;
}
export interface Vector {
  id: string;
  cohort: string;
  argv?: string[];
  inputHex: string;
  files?: Record<string, string>;
  transport?: string;
  allBoundaries?: boolean;
  stages?: Stage[];
  expected: BytesResult;
}
const maximumBytes = 65536;
const jqOptions = { limits: { maxInputBytes: maximumBytes, maxOutputBytes: maximumBytes, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export async function* chunks(input: Uint8Array, transport: string): ByteSource {
  if (transport === "bytewise") {
    for (let offset = 0; offset < input.length; offset++) yield input.subarray(offset, offset + 1);
  } else if (transport.startsWith("split:")) {
    const offset = Number(transport.slice(6));
    assert.ok(Number.isInteger(offset) && offset > 0 && offset < input.length);
    yield input.subarray(0, offset);
    yield input.subarray(offset);
  } else {
    assert.equal(transport, "whole");
    if (input.length) yield input;
  }
}
export function collector() {
  const output: Buffer[] = [];
  let size = 0;
  return {
    sink: { async write(bytes: Uint8Array) {
      size += bytes.length;
      assert.ok(size <= maximumBytes, "review output exceeded byte cap");
      output.push(Buffer.from(bytes));
    } },
    hex: () => Buffer.concat(output).toString("hex"),
  };
}
export async function loadPublicHarness() {
  const { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } = await import("../../../../src/index.js");
  async function filesystem(vector: Vector) {
    const fs = new MemoryFileSystem();
    for (const [name, hex] of Object.entries(vector.files ?? {})) {
      assert.match(name, /^[a-z]+\.txt$/u);
      await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
    }
    return fs;
  }
  async function directStage(vector: Vector, argv: string[], inputHex: string, transport: string): Promise<BytesResult> {
    const stdout = collector();
    const stderr = collector();
    const context: CommandContext = {
      command: "jq", args: argv, fs: await filesystem(vector), cwd: "/", env: {},
      stdin: chunks(Buffer.from(inputHex, "hex"), transport), stdinIsDefault: false,
      stdout: stdout.sink, stderr: stderr.sink, signal: AbortSignal.timeout(1500),
    };
    const definition = createStructuredCommands(jqOptions).find(command => command.name === "jq");
    assert.ok(definition, "public factory must expose jq");
    const result = await definition.execute(context);
    return { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() };
  }
  async function execute(vector: Vector, route: "direct" | "shell", transport: string): Promise<{ actual: BytesResult; stages?: BytesResult[] }> {
    if (route === "direct") {
      if (!vector.stages) return { actual: await directStage(vector, vector.argv!, vector.inputHex, transport) };
      let inputHex = vector.inputHex;
      const stages: BytesResult[] = [];
      for (const [index, stage] of vector.stages.entries()) {
        const result = await directStage(vector, stage.argv, inputHex, index === 0 ? transport : "whole");
        stages.push(result);
        inputHex = result.stdoutHex;
      }
      return { actual: { status: stages.at(-1)!.status, stdoutHex: inputHex, stderrHex: stages.map(stage => stage.stderrHex).join("") }, stages };
    }
    const script = (vector.stages ?? [{ argv: vector.argv! }]).map(stage => ["jq", ...stage.argv.map(quote)].join(" ")).join(" | ");
    const stdout = collector();
    const stderr = collector();
    const shell = new Shell({ fs: await filesystem(vector), cwd: "/", env: {}, limits: { maxOutputBytes: maximumBytes, pipeHighWaterMark: 1 } }).use(structuredCommands(jqOptions));
    const result = await shell.exec(script, { stdin: chunks(Buffer.from(vector.inputHex, "hex"), transport), stdout: stdout.sink, stderr: stderr.sink, signal: AbortSignal.timeout(1500) });
    return { actual: { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() } };
  }
  return execute;
}
