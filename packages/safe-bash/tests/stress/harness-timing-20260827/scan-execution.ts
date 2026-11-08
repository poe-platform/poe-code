import { createHash } from "node:crypto";
import { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } from "../../../src/index.js";
import { chunks, collector, quote, type Vector } from "../../commands/structured-stress/jq-42-independent-review/harness.js";
import { trace } from "./trace.js";
import { withHarnessWatchdog } from "./watchdog.js";

trace("jq-module-ready", {});
let invocation = 0;
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

export async function execute(vector: Vector, route: "direct" | "shell", transport: string, watchdogMs = 15000) {
  const identity = { invocation: ++invocation, vector: vector.id, route, transport };
  const fs = new MemoryFileSystem();
  for (const [name, hex] of Object.entries(vector.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
  let readEntered = false;
  const entered = (source: string) => {
    if (!readEntered) { readEntered = true; trace("jq-entered-read", { ...identity, source }); }
  };
  if (transport !== "whole") {
    fs.readStream = async function* (path, options) {
      entered("file");
      const bytes = await fs.readFile(path, options);
      const fileTransport = transport.startsWith("split:") && Number(transport.slice(6)) >= bytes.length ? "bytewise" : transport;
      yield* partition(bytes, fileTransport);
    };
  }
  const stdout = collector();
  const stderr = collector();
  let firstOutput = true;
  const sink = (name: string, target: typeof stdout.sink) => ({ async write(bytes: Uint8Array) {
    if (firstOutput) { firstOutput = false; trace("jq-first-data", { ...identity, sink: name, bytes: bytes.length }); }
    await target.write(bytes);
  } });
  const stdin = (async function* () { entered("stdin"); yield* partition(Buffer.from(vector.inputHex, "hex"), transport); })();
  const options = { limits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };
  trace("jq-execute-start", { ...identity, watchdogMs });
  const started = performance.now();
  try {
    const result = await withHarnessWatchdog(watchdogMs, async signal => route === "direct"
      ? await createStructuredCommands(options).find(command => command.name === "jq")!.execute({ command: "jq", args: vector.argv!, fs, cwd: "/", env: {}, stdin, stdinIsDefault: false, stdout: sink("stdout", stdout.sink), stderr: sink("stderr", stderr.sink), signal })
      : await new Shell({ fs, cwd: "/", env: {}, limits: { maxOutputBytes: 65536 } }).use(structuredCommands(options)).exec(["jq", ...vector.argv!.map(quote)].join(" "), { stdin, stdout: sink("stdout", stdout.sink), stderr: sink("stderr", stderr.sink), signal }));
    const triple = { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() };
    trace("jq-execute-complete", { ...identity, durationMs: performance.now() - started, sha256: createHash("sha256").update(JSON.stringify(triple)).digest("hex") });
    return triple;
  } catch (error) {
    trace("jq-execute-failed", { ...identity, durationMs: performance.now() - started, error: String(error) });
    throw error;
  }
}
