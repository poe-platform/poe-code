# Poe agent background command native QA

1. Run the original native background control below independently with the built shell plugin and actual Node spawn. Import the original Tool/ToolContext types and Vitest helpers.
2. Keep the two-second readiness deadline and five-second test deadline. Verify background output buffering, notifications, kill/read status and disposal with every original assertion. The original22-case fixture and posttest passed independently after this control timed out in the broad route.
3. Purge temporary fixtures/evidence under `out`.

```ts
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

```

```ts
  it("bounds retained foreground command output and marks truncation", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    const output = await callTool(plugin.tools, "run_command", {
      command: createNodeCommand(
        "process.stdout.write('x'.repeat(140_000)); process.stdout.write('tail-marker');"
      )
    });

    expect(typeof output).toBe("string");
    expect(String(output)).toContain("[output truncated:");
    expect(String(output)).toContain("tail-marker");
    expect(String(output).length).toBeLessThan(132_000);
  });

  it("bounds retained background command output and marks truncation", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    try {
      const handle = await callTool(plugin.tools, "run_command", {
        command: createNodeCommand(
          "process.stdout.write('x'.repeat(140_000)); process.stdout.write('tail-marker'); setInterval(() => {}, 1_000);"
        ),
        run_in_background: true
      });

      await waitForBackgroundOutput(plugin.tools, String(handle), "tail-marker");
      const output = await callTool(plugin.tools, "read_background", { handle });

      expect(typeof output).toBe("string");
      expect(String(output)).toContain("[output truncated:");
      expect(String(output)).toContain("tail-marker");
      expect(String(output).length).toBeLessThan(132_500);
      await callTool(plugin.tools, "kill_background", { handle });
    } finally {
      await plugin.dispose?.();
    }
  });

```

```ts
  it("includes captured output when a foreground command times out", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    const controller = new AbortController();
    const received = new Set<string>();
    let outputReady!: () => void;
    const ready = new Promise<void>((resolve) => { outputReady = resolve; });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = callTool(plugin.tools, "run_command", {
      command: createNodeCommand(
        "process.stdout.write('partial stdout\\n'); process.stderr.write('partial stderr\\n'); setTimeout(() => {}, 5_000);"
      ),
      timeout: 0.5
    }, controller.signal, {
      notify: async (notification) => {
        received.add(notification.event);
        if (received.has("shell.stdout") && received.has("shell.stderr")) outputReady();
      }
    }).then(String, (error: unknown) => error instanceof Error ? error.message : String(error));

    try {
      // Start the timeout clock after both streams have produced output, so
      // process startup under load cannot consume the capture assertion's window.
      await Promise.race([ready, pending]);
      await vi.advanceTimersByTimeAsync(500);
      const message = await pending;
      expect(message).toContain("Command timed out after 0.5 seconds");
      expect(message).toContain("partial stdout");
      expect(message).toContain("partial stderr");
    } finally {
      controller.abort();
      await pending;
      vi.useRealTimers();
    }
  });

```

```ts
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

```
