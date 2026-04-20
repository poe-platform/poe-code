import { describe, expect, it, vi } from "vitest";
import type { Tool } from "../runtime/plugin-types.js";
import type { ToolContext } from "../runtime/types.js";
import shellPlugin, { spec as shellPluginSpec } from "./poe-agent-plugin-shell.js";

type TestTool = Pick<Tool, "name" | "call">;

function createToolContext(signal: AbortSignal, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    fork: async () => {
      throw new Error("fork is not supported in plugin tests");
    },
    spawn: async () => {
      throw new Error("spawn is not supported in plugin tests");
    },
    signal,
    ...overrides
  };
}

async function callTool(
  tools: TestTool[] | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = new AbortController().signal,
  overrides: Partial<ToolContext> = {}
): Promise<unknown> {
  const tool = tools?.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool.call(args, createToolContext(signal, overrides));
}

function createNodeCommand(code: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
}

async function waitForBackgroundOutput(
  tools: TestTool[] | undefined,
  handle: string,
  expectedOutput: string
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const output = await callTool(tools, "read_background", { handle });
    if (typeof output === "string" && output.includes(expectedOutput)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for background output: ${expectedOutput}`);
}

describe("poe-agent-plugin-shell", () => {
  function getRunCommandValidate() {
    const plugin = shellPlugin();
    const tool = plugin.tools?.find((candidate) => candidate.name === "run_command");
    expect(tool?.policy?.validate).toBeTypeOf("function");
    return tool?.policy?.validate as (args: unknown, mode: "read" | "edit") => string | void;
  }

  it("validates config options with its plugin spec", () => {
    expect(
      shellPluginSpec.parseOptions({
        cwd: "/workspace/project",
        allowedPaths: ["src"],
      }),
    ).toEqual({
      cwd: "/workspace/project",
      allowedPaths: ["src"],
    });
    expect(() => shellPluginSpec.parseOptions({ cwd: 123 })).toThrow();
  });

  it("resolves cwd and timeout before delegating to the injected runner", async () => {
    const signal = new AbortController().signal;
    const runCommand = vi.fn(async () => "ok");
    const plugin = shellPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      runCommand
    });

    await expect(
      callTool(
        plugin.tools,
        "run_command",
        { command: "ls -la", cwd: "./subdir", timeout: 45 },
        signal
      )
    ).resolves.toBe("ok");

    expect(runCommand.mock.calls).toEqual([
      [
        "ls -la",
        "/workspace/project/subdir",
        {
          signal,
          timeoutMs: 45_000
        }
      ]
    ]);
  });

  it("starts background commands, reads buffered output, and kills them", async () => {
    const cwd = process.cwd();
    const notifications: Array<{ event: string; message?: string; data?: unknown }> = [];
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    const handle = await callTool(
      plugin.tools,
      "run_command",
      {
        command: createNodeCommand(
          "process.stdout.write('ready\\n'); setInterval(() => {}, 1_000);"
        ),
        run_in_background: true
      },
      new AbortController().signal,
      {
        notify: async (notification) => {
          notifications.push(notification);
        }
      }
    );

    expect(handle).toBeTypeOf("string");

    await waitForBackgroundOutput(plugin.tools, String(handle), "ready");
    expect(notifications).toContainEqual({
      event: "shell.stdout",
      message: "ready\n",
      data: expect.objectContaining({
        background: true,
        command: expect.any(String),
        cwd,
        handle,
        stream: "stdout"
      })
    });

    await expect(callTool(plugin.tools, "kill_background", { handle })).resolves.toBe(
      `Killed background command: ${handle}`
    );
    await expect(callTool(plugin.tools, "read_background", { handle })).resolves.toContain(
      "Status: exited"
    );

    await plugin.dispose?.();
  });

  it("times out foreground commands", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    await expect(
      callTool(plugin.tools, "run_command", {
        command: createNodeCommand("setTimeout(() => {}, 5_000);"),
        timeout: 0.05
      })
    ).rejects.toThrow("Command timed out after 0.05 seconds");
  });

  it("aborts foreground commands when the tool signal is aborted", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });
    const controller = new AbortController();
    const pending = callTool(
      plugin.tools,
      "run_command",
      {
        command: createNodeCommand("setTimeout(() => {}, 5_000);")
      },
      controller.signal
    );

    controller.abort(new Error("stop"));

    await expect(pending).rejects.toThrow("Command aborted");
  });

  it("rejects dedicated file/search/list shell commands in read mode", () => {
    const validate = getRunCommandValidate();

    expect(validate({ command: "cat package.json" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead",
    );
    expect(validate({ command: "ls src" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead",
    );
    expect(validate({ command: "grep foo README.md" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead",
    );
    expect(validate({ command: "find src -maxdepth 1 -type f" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead",
    );
    expect(validate({ command: "rg foo src" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead",
    );
  });

  it("rejects shell-wrapped dedicated file/list/search reads in read mode", () => {
    const validate = getRunCommandValidate();

    expect(validate({ command: "bash -lc 'cat package.json'" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead of shell wrappers",
    );
    expect(validate({ command: "sh -lc 'ls src'" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead of shell wrappers",
    );
    expect(validate({ command: "python - <<'PY'\nprint(open(\"package.json\").read())\nPY" }, "read")).toContain(
      "Use the dedicated file/search/list tools instead of shell wrappers",
    );
  });

  it("rejects cd wrappers in favor of the cwd argument", () => {
    const validate = getRunCommandValidate();

    expect(validate({ command: "cd src && ls" }, "read")).toBe(
      'Use the "cwd" argument instead of prefixing commands with "cd".',
    );
    expect(validate({ command: "cd src; pwd" }, "edit")).toBe(
      'Use the "cwd" argument instead of prefixing commands with "cd".',
    );
  });

  it("allows shell wrappers for non-file workflows in read mode", () => {
    const validate = getRunCommandValidate();

    expect(validate({ command: "bash -lc 'git status --short'" }, "read")).toBeUndefined();
  });

  it("emits notification events for shell output", async () => {
    const cwd = process.cwd();
    const notifications: Array<{ event: string; message?: string; data?: unknown }> = [];
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    await expect(
      callTool(
        plugin.tools,
        "run_command",
        {
          command: createNodeCommand(
            "process.stdout.write('ready\\n'); process.stderr.write('warn\\n');"
          )
        },
        new AbortController().signal,
        {
          notify: async (notification) => {
            notifications.push(notification);
          }
        }
      )
    ).resolves.toContain("ready");

    expect(notifications).toEqual([
      {
        event: "shell.stdout",
        message: "ready\n",
        data: expect.objectContaining({
          background: false,
          command: expect.any(String),
          cwd,
          stream: "stdout"
        })
      },
      {
        event: "shell.stderr",
        message: "warn\n",
        data: expect.objectContaining({
          background: false,
          command: expect.any(String),
          cwd,
          stream: "stderr"
        })
      }
    ]);
  });
});
