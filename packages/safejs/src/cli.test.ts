import { EventEmitter } from "node:events";

import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrokenPipeSink, createSink } from "../test/sinks.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { createSandboxClosure, createSandboxPromise } = await import("./interp/values.js");
const { runCli } = await import("./cli.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("SafeJS CLI", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/repo", { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints help and exits zero for --help", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["--help"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toContain(
      "Usage: poe-safejs [options] <script.md|script.safejs|script.ajs>"
    );
    expect(stdout.output()).toContain("--snapshot <path>");
    expect(stderr.output()).toBe("");
  });

  it("says in the help text that --fs is a real filesystem, unlike the bundled stubs", async () => {
    const stdout = createSink();

    const exitCode = await runCli(["--help"], { cwd: "/repo", stdout, stderr: createSink() });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toContain("--fs ");
    expect(stdout.output()).toContain("--fs-root <path>");
    expect(stdout.output()).toMatch(/--fs .*real filesystem/);
  });

  it("exposes no fs module by default", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync("/repo/data.txt", "secret");
    vol.writeFileSync(
      "/repo/script.ajs",
      'import { readFile } from "fs";\nreturn await readFile("data.txt", "utf8");\n'
    );

    const exitCode = await runCli(["script.ajs"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Unknown module 'fs'");
  });

  it("registers a real fs module rooted at the script directory for --fs", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.mkdirSync("/repo/harness", { recursive: true });
    vol.writeFileSync("/repo/harness/data.txt", "hello");
    vol.writeFileSync(
      "/repo/harness/script.ajs",
      'import { readFile } from "fs";\nreturn await readFile("data.txt", "utf8");\n'
    );

    const exitCode = await runCli(["--fs", "harness/script.ajs"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: "hello" })}\n`);
  });

  // That the root *is* the script directory is pinned by the read above; this pins that the
  // confinement is enforced and that node's own EACCES reaches the script's catch.
  it("denies an --fs read escaping the root with a node-shaped EACCES", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.mkdirSync("/repo/harness", { recursive: true });
    vol.writeFileSync("/repo/outside.txt", "secret");
    vol.writeFileSync(
      "/repo/harness/script.ajs",
      [
        'import { readFile } from "fs";',
        "const read = async () => {",
        "  try {",
        '    return await readFile("../outside.txt", "utf8");',
        "  } catch (error) {",
        "    return error.code;",
        "  }",
        "};",
        "return await read();"
      ].join("\n")
    );

    const exitCode = await runCli(["--fs", "harness/script.ajs"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: "EACCES" })}\n`);
  });

  it("roots --fs at --fs-root resolved against the cwd", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.mkdirSync("/repo/harness", { recursive: true });
    vol.writeFileSync("/repo/outside.txt", "reachable");
    vol.writeFileSync(
      "/repo/harness/script.ajs",
      'import { readFile } from "fs";\nreturn await readFile("outside.txt", "utf8");\n'
    );

    const exitCode = await runCli(["--fs", "--fs-root", ".", "harness/script.ajs"], {
      cwd: "/repo",
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: "reachable" })}\n`);
  });

  it("rejects --fs-root without --fs and names the fix", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync("/repo/script.ajs", "return 1;");

    const exitCode = await runCli(["--fs-root", "/repo", "script.ajs"], {
      cwd: "/repo",
      stdout,
      stderr
    });

    expect(exitCode).not.toBe(0);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("--fs-root requires --fs");
  });

  it("rejects a blank --fs-root rather than silently widening the root", async () => {
    const stderr = createSink();
    vol.writeFileSync("/repo/script.ajs", "return 1;");

    const exitCode = await runCli(["--fs", "--fs-root", "", "script.ajs"], {
      cwd: "/repo",
      stdout: createSink(),
      stderr
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.output()).toContain("Missing value for --fs-root");
  });

  it("prints usage to stderr and exits non-zero when no path is provided", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli([], { cwd: "/repo", stdout, stderr });

    expect(exitCode).not.toBe(0);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain(
      "Usage: poe-safejs [options] <script.md|script.safejs|script.ajs>"
    );
  });

  it("reports a controlled error when the default cwd cannot be resolved", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw Object.assign(new Error("uv_cwd"), { code: "ENOENT" });
    });

    try {
      const exitCode = await runCli(["script.md"], { stdout, stderr });

      expect(exitCode).toBe(1);
      expect(stdout.output()).toBe("");
      expect(stderr.output()).toContain("Unable to resolve current working directory: uv_cwd");
    } finally {
      cwd.mockRestore();
    }
  });

  it("rejects unknown flags with the flag named", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["--bogus", "script.md"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).not.toBe(0);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Unknown flag: --bogus");
  });

  it("reports file not found with the requested path", async () => {
    const stdout = createSink();
    const stderr = createSink();

    const exitCode = await runCli(["missing.md"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).not.toBe(0);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("File not found: missing.md");
  });

  it("does not treat inherited stat error codes as missing harness files", async () => {
    const stdout = createSink();
    const stderr = createSink();

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      const exitCode = await runCli(["script.md"], {
        cwd: "/repo",
        stat: async () => {
          throw new Error("stat denied");
        },
        stdout,
        stderr
      });

      expect(exitCode).not.toBe(0);
      expect(stdout.output()).toBe("");
      expect(stderr.output()).toContain("stat denied");
      expect(stderr.output()).not.toContain("File not found");
    });
  });

  it("reports a clear error when the path is a directory", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.mkdirSync("/repo/directory.md");

    const exitCode = await runCli(["directory.md"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).not.toBe(0);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Harness path must point to a file: directory.md");
  });

  it("writes a snapshot at the requested path when the run completes", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync(
      "/repo/script.md",
      ["```js", 'console.log("done");', "return 7;", "```"].join("\n")
    );

    const exitCode = await runCli(["--snapshot", "snapshots/run.json", "script.md"], {
      cwd: "/repo",
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    expect(stdout.output()).toContain("done\n");
    expect(
      JSON.parse(vol.readFileSync("/repo/snapshots/run.json", "utf8") as string)
    ).toMatchObject({
      sourceHash: expect.any(String)
    });
  });

  it("restores from a snapshot and fails clearly when restore is invalid", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync("/repo/script.md", ["```js", "return Math.random();", "```"].join("\n"));

    const firstExitCode = await runCli(["--snapshot", "snapshots/run.json", "script.md"], {
      cwd: "/repo",
      stdout,
      stderr
    });
    const restoredExitCode = await runCli(["--restore", "snapshots/run.json", "script.md"], {
      cwd: "/repo",
      stdout: createSink(),
      stderr: createSink()
    });

    vol.writeFileSync(
      "/repo/snapshots/bad.json",
      JSON.stringify({ version: 1, sourceHash: "not-the-current-source" })
    );
    const badStderr = createSink();
    const badExitCode = await runCli(["--restore", "snapshots/bad.json", "script.md"], {
      cwd: "/repo",
      stdout: createSink(),
      stderr: badStderr
    });

    expect(firstExitCode).toBe(0);
    expect(restoredExitCode).toBe(0);
    expect(badExitCode).not.toBe(0);
    expect(badStderr.output()).toContain("source changed since snapshot was taken");
  });

  it("rejects a truncated restore snapshot from memfs", async () => {
    vol.writeFileSync("/repo/script.ajs", "return 1;");
    vol.mkdirSync("/repo/snapshots", { recursive: true });
    vol.writeFileSync("/repo/snapshots/truncated.json", '{"version":1,"sourceHash":');
    const stderr = createSink();

    const exitCode = await runCli(["--restore", "snapshots/truncated.json", "script.ajs"], {
      cwd: "/repo",
      stdout: createSink(),
      stderr
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.output()).toContain("Failed to parse snapshot at snapshots/truncated.json");
  });

  it("does not treat inherited snapshot read error codes as missing restore files", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync("/repo/script.md", ["```js", "return 1;", "```"].join("\n"));

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      const exitCode = await runCli(["--restore", "snapshots/run.json", "script.md"], {
        cwd: "/repo",
        readFile: async (filePath, encoding) => {
          if (filePath === "/repo/snapshots/run.json") {
            throw new Error("snapshot read denied");
          }

          return fs.promises.readFile(filePath, encoding);
        },
        stdout,
        stderr
      });

      expect(exitCode).not.toBe(0);
      expect(stdout.output()).toBe("");
      expect(stderr.output()).toContain("snapshot read denied");
      expect(stderr.output()).not.toContain("Snapshot not found");
    });
  });

  it("enforces --max-steps and exits with the budget message when exceeded", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync(
      "/repo/script.ajs",
      ["const loop = (value) => loop(value + 1);", "return loop(0);"].join("\n")
    );

    const exitCode = await runCli(["--max-steps", "20", "script.ajs"], {
      cwd: "/repo",
      stdout,
      stderr
    });

    expect(exitCode).toBe(3);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Budget exceeded: steps");
  });

  it("enforces --data-size and exits with the budget message when exceeded", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync(
      "/repo/script.ajs",
      'const values = ["aa", "bb", "cc", "dd", "ee", "ff"]; return values;'
    );

    const exitCode = await runCli(["--data-size", "12", "script.ajs"], {
      cwd: "/repo",
      stdout,
      stderr
    });

    expect(exitCode).toBe(3);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Budget exceeded: dataSize");
  });

  it("preserves injected __proto__ modules for raw scripts", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync("/repo/script.ajs", 'import { value } from "__proto__";\nreturn value;\n');

    const exitCode = await runCli(["script.ajs"], {
      cwd: "/repo",
      modulesFor: () => Object.fromEntries([["__proto__", { value: "preserved" }]]) as never,
      stdout,
      stderr
    });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: "preserved" })}\n`);
    expect(stderr.output()).toBe("");
  });

  it("does not expose the harness module to .safejs files", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync(
      "/repo/script.safejs",
      'import { meta } from "harness";\nreturn meta.filepath;\n'
    );

    const exitCode = await runCli(["script.safejs"], {
      cwd: "/repo",
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toBe("");
    expect(stderr.output()).toContain("Unknown module 'harness'");
  });

  it("handles SIGINT with graceful shutdown, finally blocks, and a non-zero exit", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const process = new EventEmitter();
    const wait = createDeferred<void>();

    vol.writeFileSync(
      "/repo/script.md",
      [
        "```js",
        'import { wait } from "api";',
        "const main = async () => {",
        "try {",
        "  await wait();",
        "} finally {",
        '  return "cleanup";',
        "}",
        "};",
        "return await main();",
        "```"
      ].join("\n")
    );

    const result = runCli(["--snapshot", "snapshots/signal.json", "script.md"], {
      cwd: "/repo",
      modulesFor: () => ({
        api: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(wait.promise),
            name: "wait"
          })
        }
      }),
      process,
      stdout,
      stderr
    });

    await flushMicrotasks();
    process.emit("SIGINT");
    const exitCode = await result;

    expect(exitCode).toBe(130);
    expect(stdout.output()).toBe(`${JSON.stringify({ ok: true, returnValue: "cleanup" })}\n`);
    expect(stderr.output()).toContain("Interrupted by SIGINT");
    expect(
      JSON.parse(vol.readFileSync("/repo/snapshots/signal.json", "utf8") as string)
    ).toMatchObject({
      sourceHash: expect.any(String)
    });
  });

  it("routes console.log to stdout and console.error plus runtime errors to stderr", async () => {
    const stdout = createSink();
    const stderr = createSink();
    vol.writeFileSync(
      "/repo/script.md",
      [
        "```js",
        'console.log("hello", 3);',
        'console.log("%s%s", "a", "b");',
        'console.error("bad");',
        'throw Error("boom");',
        "```"
      ].join("\n")
    );

    const exitCode = await runCli(["script.md"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).toBe(1);
    expect(stdout.output()).toContain("hello 3\n");
    expect(stdout.output()).toContain("ab\n");
    expect(stderr.output()).toContain("bad\n");
    expect(stderr.output()).toContain("boom");
  });

  it("treats stdout EPIPE as a clean early exit", async () => {
    const stdout = createBrokenPipeSink({ failAfterWrites: 1 });
    const stderr = createSink();
    vol.writeFileSync(
      "/repo/script.ajs",
      ['console.log("one");', 'console.log("two");', 'console.log("three");'].join("\n")
    );

    const exitCode = await runCli(["script.ajs"], { cwd: "/repo", stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout.output()).toBe("one\n");
    expect(stderr.output()).toBe("");
  });

  it("maps parse, runtime, and budget failures to documented exit codes", async () => {
    vol.writeFileSync("/repo/parse.ajs", "const value = ;");
    vol.writeFileSync("/repo/runtime.ajs", 'throw Error("boom");');
    vol.writeFileSync(
      "/repo/budget.ajs",
      ["const loop = (value) => loop(value + 1);", "return loop(0);"].join("\n")
    );

    await expectRunExitCode(["parse.ajs"], 2);
    await expectRunExitCode(["runtime.ajs"], 1);
    await expectRunExitCode(["--max-steps", "20", "budget.ajs"], 3);
  });

  it("does not treat inherited error names as parse failures", async () => {
    vol.writeFileSync("/repo/runtime.ajs", "throw {};");

    await withObjectPrototypeProperties({ name: "ParseError" }, async () => {
      await expectRunExitCode(["runtime.ajs"], 1);
    });
  });
});

async function expectRunExitCode(argv: readonly string[], expectedExitCode: number): Promise<void> {
  const exitCode = await runCli(argv, {
    cwd: "/repo",
    stdout: createSink(),
    stderr: createSink()
  });

  expect(exitCode).toBe(expectedExitCode);
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
}

async function flushMicrotasks(iterations = 20): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
