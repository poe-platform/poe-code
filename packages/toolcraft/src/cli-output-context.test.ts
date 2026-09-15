import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetOutputFormatCache, resolveOutputFormat, withOutputFormat } from "toolcraft-design";
import { S, defineCommand, defineGroup, defineStreamCommand, UserError } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
const previousOutputFormat = process.env.OUTPUT_FORMAT;
beforeEach(() => {
  process.exitCode = 0;
  process.env.OUTPUT_FORMAT = "terminal";
  resetOutputFormatCache();
});
afterEach(() => {
  process.exitCode = previousExitCode;
  if (previousOutputFormat === undefined) delete process.env.OUTPUT_FORMAT;
  else process.env.OUTPUT_FORMAT = previousOutputFormat;
  resetOutputFormatCache();
  vi.restoreAllMocks();
});

async function capture(callback: () => Promise<void>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const savedExitCode = process.exitCode;
  process.exitCode = 0;
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const error = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  try {
    await callback();
    return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode: process.exitCode ?? 0 };
  } finally {
    out.mockRestore();
    error.mockRestore();
    process.exitCode = savedExitCode;
  }
}

function createRoot(streaming: boolean, action: (progress: (message: string) => void) => unknown) {
  const config = { name: "read", scope: ["cli"] as const, params: S.Object({}) };
  const command = streaming
    ? defineStreamCommand({ ...config, event: S.Json(), async *handler({ progress }) { yield await action(progress); } })
    : defineCommand({ ...config, handler: ({ progress }) => action(progress) });
  return defineGroup({ name: "audit", children: [command] });
}

describe.each([false, true])("CLI output context streaming=%s", (streaming) => {
  describe.each(["terminal", "markdown", "json"] as const)("outer %s", (outer) => {
    describe.each(["rich", "md", "json"] as const)("requested %s", (requested) => {
      it.each([false, true])("keeps explicit CLI formatting with failure=%s", async (fail) => {
        const root = createRoot(streaming, (progress) => {
          progress("PROGRESS_MARKER");
          if (fail) throw new UserError("ERROR_MARKER");
          return { value: 1 };
        });
        const options = { argv: ["node", "audit", "read", "--output", requested], controls: { output: true }, errorReports: false };
        const baseline = await capture(() => runCLI(root, options));
        const nested = await capture(() => withOutputFormat(outer, async () => {
          expect(resolveOutputFormat()).toBe(outer);
          await runCLI(root, options);
          expect(resolveOutputFormat()).toBe(outer);
        }));
        expect(nested).toEqual(baseline);
        expect(process.env.OUTPUT_FORMAT).toBe("terminal");
      });
    });
  });

  describe.each(["rich", "md", "json"] as const)("first %s", (firstFormat) => {
    it.each(["rich", "md", "json"] as const)("isolates an overlapping %s invocation", async (secondFormat) => {
      const firstOptions = { argv: ["node", "audit", "read", "--output", firstFormat], controls: { output: true }, errorReports: false };
      const secondOptions = { argv: ["node", "audit", "read", "--output", secondFormat], controls: { output: true }, errorReports: false };
      const firstBaseline = await capture(() => runCLI(createRoot(streaming, (progress) => { progress("FIRST_MARKER"); return null; }), firstOptions));
      const secondBaseline = await capture(() => runCLI(createRoot(streaming, (progress) => { progress("SECOND_MARKER"); return null; }), secondOptions));
      let enterFirst!: () => void;
      let enterSecond!: () => void;
      let finishFirst!: () => void;
      const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
      const secondEntered = new Promise<void>((resolve) => { enterSecond = resolve; });
      const firstFinished = new Promise<void>((resolve) => { finishFirst = resolve; });
      const firstRoot = createRoot(streaming, async (progress) => {
        enterFirst();
        await secondEntered;
        progress("FIRST_MARKER");
        return null;
      });
      const secondRoot = createRoot(streaming, async (progress) => {
        enterSecond();
        await firstFinished;
        progress("SECOND_MARKER");
        return null;
      });
      const overlapping = await capture(async () => {
        const first = runCLI(firstRoot, firstOptions);
        await Promise.race([firstEntered, first.then(() => { throw new Error("First handler did not start"); })]);
        const second = runCLI(secondRoot, secondOptions);
        try {
          await Promise.race([secondEntered, second.then(() => { throw new Error("Second handler did not start"); })]);
          await first;
        } finally {
          enterSecond();
          finishFirst();
          await Promise.all([first, second]);
        }
      });
      expect(overlapping).toEqual({
        stdout: firstBaseline.stdout + secondBaseline.stdout,
        stderr: firstBaseline.stderr + secondBaseline.stderr,
        exitCode: 0
      });
      expect(process.env.OUTPUT_FORMAT).toBe("terminal");
    });
  });
});

describe.each([undefined, "terminal", "markdown", "json"])("parent OUTPUT_FORMAT=%s", (parent) => {
  it.each(["rich", "md", "json"] as const)("does not mutate the environment while rendering %s", async (requested) => {
    if (parent === undefined) delete process.env.OUTPUT_FORMAT;
    else process.env.OUTPUT_FORMAT = parent;
    resetOutputFormatCache();
    const observed: Array<string | undefined> = [];
    const root = createRoot(false, () => { observed.push(process.env.OUTPUT_FORMAT); return null; });
    await capture(() => runCLI(root, {
      argv: ["node", "audit", "read", "--output", requested],
      controls: { output: true },
      errorReports: false
    }));
    expect(observed).toEqual([parent]);
    expect(process.env.OUTPUT_FORMAT).toBe(parent);
  });
});

describe.each(["terminal", "markdown", "json"] as const)("early errors under %s", (outer) => {
  describe.each(["rich", "md", "json"] as const)("requested %s", (requested) => {
    it.each([{ args: ["missing"] }, { args: ["read", "--unknown"] }])("preserves explicit formatting for $args", async ({ args }) => {
      const root = createRoot(false, () => { throw new Error("Handler must not run"); });
      const options = { argv: ["node", "audit", ...args, "--output", requested], controls: { output: true }, errorReports: false };
      const baseline = await capture(() => runCLI(root, options));
      const nested = await capture(() => withOutputFormat(outer, () => runCLI(root, options)));
      expect(nested).toEqual(baseline);
      expect(nested.exitCode).toBe(1);
    });
  });
});
