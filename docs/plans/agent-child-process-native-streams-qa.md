# Agent child process native stream QA

1. Execute these original real-process controls independently using the built package API and actual Node spawn. Keep the five-second unit deadline for each control.
2. Verify success/failure exits, injected agent follow-up, exact environment handling, stdin echo, independently readable stdout/stderr plus result capture, and abort mapping. Retain every assertion below.
3. Purge temporary fixtures/evidence under `out` after verification.

```ts
  it("runs fast real child processes", async () => {
    const success = await execFile(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { spawnProcess: nodeSpawn }
    );

    const failure = await execFile(process.execPath, ["-e", "process.exit(3)"], {
      spawnProcess: nodeSpawn
    });

    expect(success).toMatchObject({ stdout: "out", stderr: "err", exitCode: 0 });
    expect(failure).toMatchObject({ exitCode: 3 });
  });

  it("runs a real child process and uses an injected agent follow-up", async () => {
    const runAgent = vi.fn<AgentChildProcessRunAgent>().mockResolvedValue({
      stdout: "agent follow-up",
      stderr: "",
      exitCode: 0
    });

    const result = await execFile(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(4)"],
      {
        spawnProcess: nodeSpawn,
        runAgent,
        context: "Integration follow-up context.",
        onExit: {
          agent: "codex",
          prompt: "Inspect the failed command."
        }
      }
    );

    expect(result).toMatchObject({
      stdout: "out",
      stderr: "err",
      exitCode: 4,
      agent: {
        agent: "codex",
        stdout: "agent follow-up",
        stderr: "",
        exitCode: 0
      }
    });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "codex",
        prompt: expect.stringContaining("Integration follow-up context.")
      })
    );
  });

  it("passes env exactly to real child processes without merging process.env", async () => {
    const result = await execFile(
      process.execPath,
      [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "exact: process.env.EXACT_ONLY,",
          "path: process.env.PATH ?? null",
          "}));"
        ].join("")
      ],
      {
        spawnProcess: nodeSpawn,
        env: { EXACT_ONLY: "yes" }
      }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      exact: "yes",
      path: null
    });
  });

  it("supports stdin for real spawned child processes", async () => {
    const handle = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      spawnProcess: nodeSpawn
    });

    expect(handle.stdin).not.toBeNull();
    handle.stdin!.end("input");

    await expect(handle.result).resolves.toMatchObject({
      stdout: "input",
      exitCode: 0
    });
  });

  it("keeps real spawned stdout readable while also capturing the result", async () => {
    const handle = spawn(
      process.execPath,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { spawnProcess: nodeSpawn }
    );
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    handle.stdout?.on("data", (chunk) => stdoutChunks.push(String(chunk)));
    handle.stderr?.on("data", (chunk) => stderrChunks.push(String(chunk)));

    await expect(handle.result).resolves.toMatchObject({
      stdout: "out",
      stderr: "err",
      exitCode: 0
    });
    expect(stdoutChunks.join("")).toBe("out");
    expect(stderrChunks.join("")).toBe("err");
  });

  it("turns real abort signal errors into failed attempts", async () => {
    const controller = new AbortController();
    const resultPromise = execFile(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      spawnProcess: nodeSpawn,
      signal: controller.signal
    });

    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({
      command: process.execPath,
      exitCode: 1
    });
    await expect(resultPromise).resolves.toHaveProperty("stderr", expect.any(String));
  });
```
