import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell, CommandRegistry, nodeCommands, type SafeJsRuntime, type ShellOptions } from "poe-code/safe-bash";
import { createSafeBashMcpServer } from "./index.js";

const servers: ReturnType<typeof createSafeBashMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.shell.dispose()));
});

async function initialized(options: Parameters<typeof createSafeBashMcpServer>[0] = {}) {
  const server = createSafeBashMcpServer(options);
  servers.push(server);
  await server.handleMessage("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "safe-bash-test", version: "1.0.0" }
  });
  return server;
}

describe("safe-bash MCP", () => {
  it("advertises a validated shell tool with structured output", async () => {
    const server = await initialized();
    const response = await server.handleMessage("tools/list");
    expect(response.result).toMatchObject({ tools: [{
      name: "shell_execute",
      inputSchema: {
        required: ["command"], additionalProperties: false,
        properties: { command: { type: "string", minLength: 1 } }
      },
      outputSchema: { required: ["stdout", "stderr", "exitCode"] }
    }] });
  });

  it("returns stdout, stderr and a nonzero exit without losing output", async () => {
    const server = await initialized();
    const response = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: "printf out; printf err >&2; exit 7" }
    });
    const output = { stdout: "out", stderr: "err", exitCode: 7 };
    expect(response).toEqual({ result: {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output, isError: true
    } });
  });

  it("reuses the filesystem but preserves safe-bash per-exec cwd and env semantics", async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/workspace");
    const server = await initialized({ fs, cwd: "/workspace", env: { LABEL: "base" } });
    await server.handleMessage("tools/call", {
      name: "shell_execute",
      arguments: { command: "cat > saved; export LABEL=changed; cd /", stdin: "retained" }
    });
    const response = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: "cat saved; printf ':%s:%s' \"$PWD\" \"$LABEL\"" }
    });
    expect(response.result).toMatchObject({
      structuredContent: { stdout: "retained:/workspace:base", stderr: "", exitCode: 0 }, isError: false
    });
    expect(new TextDecoder().decode(await fs.readFile("/workspace/saved"))).toBe("retained");
    const override = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: "printf '%s:%s' \"$PWD\" \"$LABEL\"", cwd: "/", env: { LABEL: "call" } }
    });
    expect(override.result).toMatchObject({ structuredContent: { stdout: "/:call" } });
  });

  it("isolates default filesystems and never falls back to host commands or environment", async () => {
    const first = await initialized();
    const second = await initialized();
    await first.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "printf private > /secret" } });
    const missing = await second.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "cat /secret" } });
    expect(missing.result).toMatchObject({ isError: true });
    const host = await first.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "/bin/sh -c 'echo unsafe'" } });
    expect(host.result).toMatchObject({ structuredContent: { stdout: "", exitCode: 127 }, isError: true });
    const env = await first.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "printf '%s' \"$HOME\"" } });
    expect(env.result).toMatchObject({ structuredContent: { stdout: "" } });
  });

  it.each([
    {}, { command: 1 }, { command: "" }, { command: "true", stdin: 4 },
    { command: "true", cwd: false }, { command: "true", env: { SECRET: 1 } },
    { command: "true", limits: { maxCommands: 0 } }, { command: "true", fs: {} }
  ])("rejects invalid arguments before executing: %j", async argumentsValue => {
    const server = await initialized();
    const exec = vi.spyOn(server.shell, "exec");
    const response = await server.handleMessage("tools/call", { name: "shell_execute", arguments: argumentsValue });
    expect(response.error).toMatchObject({ code: -32602 });
    expect(exec).not.toHaveBeenCalled();
  });

  it("constructs one injected runtime with the configured filesystem, commands and limits", async () => {
    const fs = createMemoryFileSystem();
    const commands = new CommandRegistry();
    const createShell = vi.fn((options: ShellOptions) => new Shell(options));
    const server = await initialized({ fs, commands, createShell, limits: { maxCommands: 4 } });
    expect(createShell).toHaveBeenCalledExactlyOnceWith({ fs, commands, limits: { maxCommands: 4 } });
    for (const command of ["true", "false"]) {
      await server.handleMessage("tools/call", { name: "shell_execute", arguments: { command } });
    }
    expect(createShell).toHaveBeenCalledTimes(1);
    const restricted = await server.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "cat /file" } });
    expect(restricted.result).toMatchObject({ structuredContent: { exitCode: 127 } });
  });

  it("serializes calls and continues after runtime errors", async () => {
    const server = await initialized();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const exec = vi.spyOn(server.shell, "exec")
      .mockImplementationOnce(async () => { await gate; throw new Error("runtime failed"); })
      .mockResolvedValueOnce({ stdout: "next", stderr: "", exitCode: 0, stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
    const first = server.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "first" } });
    const second = server.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "second" } });
    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(1));
    release();
    expect((await first).result).toMatchObject({ isError: true });
    expect((await second).result).toMatchObject({ structuredContent: { stdout: "next" } });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("shares the configured filesystem with an injected SafeJS node runtime", async () => {
    const fs = createMemoryFileSystem();
    const run = vi.fn<SafeJsRuntime<object>["run"]>(async (_source, options) => {
      options.sink.log("injected runtime");
      return { ok: true };
    });
    const makeFsModule = vi.fn<SafeJsRuntime<object>["makeFsModule"]>(() => ({}));
    const runtime: SafeJsRuntime<object> = {
      run,
      makeFsModule,
      createBudget: options => ({ ...options }),
      declareHostOperation: operation => operation
    };
    const server = await initialized({
      fs,
      createShell: options => new Shell(options).use(nodeCommands({ runtime }))
    });
    const response = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: "node -e 'console.log(42)'" }
    });
    expect(response.result).toMatchObject({
      structuredContent: { stdout: "injected runtime\n", stderr: "", exitCode: 0 }
    });
    expect(run).toHaveBeenCalledOnce();
    expect(makeFsModule).toHaveBeenCalledWith(expect.objectContaining({ adapter: fs, cwd: "/" }));
  });

  it("enforces configured shell limits", async () => {
    const server = await initialized({ limits: { maxCommands: 1 } });
    const response = await server.handleMessage("tools/call", { name: "shell_execute", arguments: { command: "true; true" } });
    expect(response.result).toMatchObject({ isError: true });
  });

  it("runs the public SafeJS runtime through MCP against files written by Bash", async () => {
    const { Budget, run, makeFsModule, declareHostOperation } = await import("poe-code/safe-js");
    const server = await initialized({
      createShell: options => new Shell(options).use(nodeCommands({ runtime: {
        run, makeFsModule, declareHostOperation, createBudget: limits => new Budget(limits)
      } }))
    });
    const response = await server.handleMessage("tools/call", {
      name: "shell_execute",
      arguments: {
        command: `printf shell > /shared; node -e 'import fs from "fs"; await fs.writeFile("/shared", (await fs.readFile("/shared", "utf8")) + ":node"); console.error("notice")'; cat /shared`
      }
    });
    expect(response.result).toMatchObject({
      structuredContent: { stdout: "shell:node", stderr: "notice\n", exitCode: 0 }, isError: false
    });
    const denied = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: `node -e 'require("node:child_process")'` }
    });
    expect(denied.result).toMatchObject({ structuredContent: { stdout: "", exitCode: 1 }, isError: true });
  });

  it("passes MCP cwd, env and stdin overrides into the actual SafeJS node command", async () => {
    const { Budget, run, makeFsModule, declareHostOperation } = await import("poe-code/safe-js");
    const fs = createMemoryFileSystem();
    await fs.mkdir("/workspace");
    const createShell = vi.fn((options: ShellOptions) => new Shell(options).use(nodeCommands({ runtime: {
      run, makeFsModule, declareHostOperation, createBudget: limits => new Budget(limits)
    } })));
    const server = await initialized({ fs, env: { LABEL: "initial" }, createShell });
    const result = await server.handleMessage("tools/call", {
      name: "shell_execute",
      arguments: {
        cwd: "/workspace", env: { LABEL: "override" }, stdin: "input",
        command: `node -e 'const fs = require("node:fs/promises"); await fs.writeFile("result", await process.stdin.readText()); console.log(process.cwd(), process.env.LABEL, process.argv[2]); await process.stdout.write(await fs.readFile("result", "utf8")); await process.stderr.write("diagnostic"); process.exitCode = 9' -- first 'two words'`
      }
    });
    expect(result.result).toMatchObject({
      structuredContent: { stdout: "/workspace override two words\ninput", stderr: "diagnostic", exitCode: 9 }, isError: true
    });
    expect(new TextDecoder().decode(await fs.readFile("/workspace/result"))).toBe("input");
    expect(createShell).toHaveBeenCalledOnce();
    const next = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: `node -p 'process.cwd() + ":" + process.env.LABEL'` }
    });
    expect(next.result).toMatchObject({ structuredContent: { stdout: "/:initial\n", exitCode: 0 } });
  });

  it("keeps node disabled by default and enforces injected node-specific limits", async () => {
    const defaults = await initialized();
    const absent = await defaults.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: "node -p '1 + 2'" }
    });
    expect(absent.result).toMatchObject({ structuredContent: { stdout: "", exitCode: 127 }, isError: true });
    const { Budget, run, makeFsModule, declareHostOperation } = await import("poe-code/safe-js");
    const server = await initialized({
      createShell: options => new Shell(options).use(nodeCommands({
        limits: { maxSourceBytes: 8 },
        runtime: { run, makeFsModule, declareHostOperation, createBudget: limits => new Budget(limits) }
      }))
    });
    const limited = await server.handleMessage("tools/call", {
      name: "shell_execute", arguments: { command: `node -e 'console.log("not executed")'` }
    });
    expect(limited.result).toMatchObject({ structuredContent: { stdout: "", exitCode: 124 }, isError: true });
  });

  it("serves JSON-RPC over streams without mixing shell stdout into protocol output", async () => {
    const server = createSafeBashMcpServer();
    servers.push(server);
    const readable = new PassThrough();
    const writable = new PassThrough();
    let output = "";
    writable.on("data", chunk => { output += chunk.toString(); });
    const connection = server.connect({ readable, writable });
    readable.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-11-25", clientInfo: { name: "test", version: "1" }
    } }) + "\n");
    await vi.waitFor(() => expect(output).toContain('"id":1'));
    readable.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
      name: "shell_execute", arguments: { command: "printf protocol-safe" }
    } }) + "\n");
    await vi.waitFor(() => expect(output).toContain('"id":2'));
    readable.end();
    await connection;
    const messages = output.trim().split("\n").map(line => JSON.parse(line));
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ id: 2, result: { structuredContent: { stdout: "protocol-safe", stderr: "", exitCode: 0 } } });
  });
});
