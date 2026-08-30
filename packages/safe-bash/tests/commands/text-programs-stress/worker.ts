import { parentPort } from "node:worker_threads";
import { createTextProgramCommands, type TextProgramOptions } from "../../../src/commands/text-programs/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { CommandRegistry, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import type { TextCase } from "./cases.js";
import type { Execution, Observation } from "./model.js";
import { runSafety, type SafetyProbe } from "./safety.js";

export interface Request { fixture: TextCase; options?: TextProgramOptions; probe?: SafetyProbe }

async function execute({ fixture, options }: Request): Promise<Execution> {
  const started = performance.now();
  const definitions = createTextProgramCommands(options);
  const definition = definitions.find(command => command.name === fixture.tool);
  if (fixture.tool !== "pipeline" && !definition || fixture.script?.includes("awk ") && !definitions.some(command => command.name === "awk")) {
    return { status: "pending", reason: `${fixture.tool === "pipeline" ? "awk" : fixture.tool} is not registered by the delivered text-program plugin`, durationMs: 0 };
  }
  try {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const [path, data] of Object.entries(fixture.files ?? {})) {
      await fs.mkdir(`/work/${path.slice(0, path.lastIndexOf("/") + 1)}`, { recursive: true, mode: 0o755 });
      await fs.writeFile(`/work/${path}`, Buffer.from(data, "base64"), { mode: 0o644 });
    }
    const stdin: ByteSource = (async function* () {
      const bytes = Buffer.from(fixture.stdin ?? "", "base64");
      const width = fixture.chunkWidth ?? 4096;
      for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width);
    })();
    const captured: Record<"stdout" | "stderr", Uint8Array[]> = { stdout: [], stderr: [] };
    let size = 0;
    const sink = (stream: "stdout" | "stderr") => ({ async write(bytes: Uint8Array) {
      size += bytes.length;
      if (size > 1024 * 1024) throw new Error("Independent output quota exceeded");
      captured[stream].push(bytes.slice());
    } });
    const context: CommandContext = { command: fixture.tool, args: fixture.args, stdin,
      fs, cwd: "/work", env: { LC_ALL: "C", LANG: "C", TZ: "UTC", PATH: "/usr/bin:/bin" },
      signal: new AbortController().signal, stdout: sink("stdout"), stderr: sink("stderr") };
    let exitCode: number;
    if (fixture.tool === "pipeline") {
      const shell = new Shell({ fs, cwd: "/work", env: context.env, commands: new CommandRegistry([...createStandardCommands(), ...definitions]) });
      try { exitCode = (await shell.exec(fixture.script!, { stdin, stdout: context.stdout, stderr: context.stderr, limits: { maxOutputBytes: 1024 * 1024 } })).exitCode; }
      finally { await shell.dispose(); }
    } else exitCode = (await definition!.execute(context)).exitCode;
    const files: Observation["files"] = {};
    const visit = async (relative: string): Promise<void> => {
      for (const entry of await fs.readdir(`/work/${relative}`)) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        const stat = await fs.lstat(`/work/${path}`);
        files[path] = stat.type === "file" ? { type: "file", bytes: Buffer.from(await fs.readFile(`/work/${path}`)).toString("base64"), mode: stat.mode & 0o777 }
          : { type: stat.type, mode: stat.mode & 0o777 };
        if (stat.type === "directory") await visit(path);
      }
    };
    await visit("");
    return { status: "completed", observation: { exitCode, stdout: Buffer.concat(captured.stdout).toString("base64"), stderr: Buffer.concat(captured.stderr).toString("base64"), files }, durationMs: performance.now() - started };
  } catch (error) { return { status: "error", reason: String(error), durationMs: performance.now() - started }; }
}

parentPort!.on("message", async ({ id, request }: { id: number; request: Request }) => {
  parentPort!.postMessage({ id, result: request.probe ? await runSafety(request.probe) : await execute(request) });
});
