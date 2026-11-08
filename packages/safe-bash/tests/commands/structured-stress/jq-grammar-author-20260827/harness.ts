import { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } from "../../../../src/index.js";
import { chunks, collector, quote, type Vector } from "../jq-42-independent-review/harness.js";
async function* partition(bytes: Uint8Array, transport: string) {
  if (transport.startsWith("size:")) {
    const size = Number(transport.slice(5));
    for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
  } else if (transport === "split:0" || transport === `split:${bytes.length}`) {
    const boundary = Number(transport.slice(6));
    yield bytes.subarray(0, boundary);
    yield bytes.subarray(boundary);
  } else yield* chunks(bytes, transport);
}

export async function execute(vector: Vector, route: "direct" | "shell", transport: string) {
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(vector.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  if (transport !== "whole") {
    fs.readStream = async function* (path, options) {
      const bytes = await fs.readFile(path, options);
      const fileTransport = transport.startsWith("split:") && Number(transport.slice(6)) >= bytes.length ? "bytewise" : transport;
      yield* partition(bytes, fileTransport);
    };
  }
  const stdout = collector();
  const stderr = collector();
  const stdin = partition(Buffer.from(vector.inputHex, "hex"), transport);
  const signal = AbortSignal.timeout(1500);
  const options = { limits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };
  const result = route === "direct"
    ? await createStructuredCommands(options).find(command => command.name === "jq")!.execute({ command: "jq", args: vector.argv!, fs, cwd: "/", env: {}, stdin, stdinIsDefault: false, stdout: stdout.sink, stderr: stderr.sink, signal })
    : await new Shell({ fs, cwd: "/", env: {}, limits: { maxOutputBytes: 65536 } }).use(structuredCommands(options)).exec(["jq", ...vector.argv!.map(quote)].join(" "), { stdin, stdout: stdout.sink, stderr: stderr.sink, signal });
  return { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() };
}
