# Poe agent native shell notification QA

1. Copy `packages/poe-agent/src/plugins/poe-agent-plugin-shell.test.ts` to a temporary sibling Vitest fixture and replace only its unresolved-notification case with the original native control below. Retain the existing imports and helper declarations.
2. Run the exact fixture through the maintained root test selector with the original one-second command completion deadline and five-second test deadline.
3. Verify a real Node process writes `ready`, its command completes despite the unresolved notification promise, and the stdout notification reaches the callback.
4. The fast unit test retains the same unresolved promise, deadline and notification/output assertions using the file's existing child-process boundary fixture and an in-memory filesystem.
5. Store evidence under `out` and remove the temporary fixture after verification.

```ts
  it("does not wait forever for unresolved shell output notifications", async () => {
    const cwd = process.cwd();
    const notify = vi.fn(() => new Promise<void>(() => undefined));
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });
    let timeout: NodeJS.Timeout | undefined;

    try {
      const result = await Promise.race([
        callTool(
          plugin.tools,
          "run_command",
          {
            command: createNodeCommand("process.stdout.write('ready\\n');")
          },
          new AbortController().signal,
          {
            notify
          }
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error("Timed out waiting for command completion"));
          }, 1_000);
        })
      ]);

      expect(result).toContain("ready");
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "shell.stdout",
          message: "ready\n"
        })
      );
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  });
```
