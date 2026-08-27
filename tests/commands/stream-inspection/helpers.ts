import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { type CommandContext, type ByteSource } from "../../../src/contracts/index.js";
import { createStreamInspectionCommands, type StreamInspectionCommandsOptions } from "../../../src/commands/stream-inspection/index.js";

export type Name = "tac" | "expand" | "fold" | "strings";
export interface Fixture {
  readonly id: string;
  readonly command: Name;
  readonly args: readonly string[];
  readonly stdinHex: string;
  readonly files?: Readonly<Record<string, string>>;
}

export function fixture(id: string, command: Name, args: readonly string[], stdin: string | Uint8Array, files?: Readonly<Record<string, string>>): Fixture {
  return { id, command, args, stdinHex: Buffer.from(stdin).toString("hex"), ...(files ? { files } : {}) };
}

export async function runFixture(specimen: Fixture, options: StreamInspectionCommandsOptions = {}, overrides: Partial<CommandContext> = {}, chunkSize = 7) {
  const fs = overrides.fs ?? createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  for (const [name, hex] of Object.entries(specimen.files ?? {})) await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
  const bytes = Buffer.from(specimen.stdinHex, "hex");
  const stdin: ByteSource = (async function* () {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
  })();
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: specimen.command, args: specimen.args, stdin, fs, cwd: "/work", env: { LC_ALL: "C" },
    signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } }, ...overrides,
  };
  const definition = createStreamInspectionCommands(options).find(candidate => candidate.name === specimen.command)!;
  const result = await definition.execute(context);
  return { ...result, stdoutHex: Buffer.concat(stdout).toString("hex"), stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), fs };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}
