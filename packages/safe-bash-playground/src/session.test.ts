import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_LIMITS } from "./session.js";
import { sampleFiles } from "./samples.js";
import { browserWorkerFixture } from "../test/browser-worker.js";

vi.mock("virtual:safe-bash-worker-sources", async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  return { sources: (await buildBrowserEngine({ workersOnly: true })).workerSources };
});

vi.mock("./engine/index.js", async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  const built = await buildBrowserEngine();
  return import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`
  );
});

const fileLimit = 2 * 1024 * 1024;
const workspaceLimit = 16 * 1024 * 1024;
let fixture: ReturnType<typeof browserWorkerFixture>;
beforeAll(async () => {
  const { buildBrowserEngine } = await import("./engine/build-plugin.mjs");
  fixture = browserWorkerFixture((await buildBrowserEngine({ entry: "../execution-worker.ts" })).code);
  vi.stubGlobal("Worker", fixture.Worker);
});
afterEach(async () => {
  try {
    expect(fixture.workers.size).toBe(0);
  } finally {
    await fixture.close();
  }
});
afterAll(() => vi.unstubAllGlobals());

describe("PlaygroundSession", () => {
  it("publishes the same byte budgets used by editing and uploads", () => {
    expect(SESSION_LIMITS).toEqual({ maxFileBytes: fileLimit, maxTotalBytes: workspaceLimit });
  });

  it("registers accurate playground help in the real shell", async () => {
    const session = await createSession();
    const result = await session.run("help");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Safe Bash playground");
    expect(result.stdout).toContain("Registered commands:");
    expect(result.stdout).toContain("Shell builtins:");
    expect(result.stdout).toContain("Playground command:");
    expect(result.stdout).toContain("UI-only controls:");
    expect(result.stdout).toContain("clear");
    expect(result.stdout).toContain("cat");
    expect(result.stdout).toContain("help");
    expect(result.stdout).toContain("bash examples/hello.sh");
    expect(result.stdout).toContain("2 MiB");
    expect(result.stdout).toContain("16 MiB");
    expect(result.stdout).toContain("64 KiB");
    expect(result.stdout).toContain("5-second deadline terminates the dedicated shell worker");
    expect(result.stdout).toContain("not installed");
    expect(result.stdout).toContain("All 79 agent commands");
    expect(result.stdout).toContain("Web Workers");
    expect(result.stdout).toContain("Regex/ERE workers use protocol work/byte budgets and timeouts.");
    expect(result.stdout).toContain("Node resourceLimits heap/stack caps are not enforced in browser workers.");
    expect(result.stdout).toContain("Worker cleanup does not guarantee page survival under memory exhaustion.");
    expect(result.stdout).not.toContain("grep, rg, sed, awk, jq, and [[ =~ ]] are unavailable");
    expect(await session.complete("hel")).toContain("help");
    const builtins = result.stdout.split("Shell builtins:\n")[1]!.split("\n")[0]!.split(" ");
    const types = await session.run(`type -t ${builtins.join(" ")}`);
    expect(types.exitCode).toBe(0);
    expect(types.stderr).toBe("");
    expect(types.stdout.split("\n").slice(0, -1), builtins.join(", ")).toEqual(builtins.map(() => "builtin"));
    expect(types.stdout.endsWith("\n")).toBe(true);
  });

  it("supports real help pipelines, redirects, and command dispatch", async () => {
    const session = await createSession();
    expect(await session.run("help | head -n 1")).toMatchObject({
      stdout: "Safe Bash playground\n",
      stderr: "",
      exitCode: 0
    });
    expect((await session.run("command help > help.txt")).exitCode).toBe(0);
    expect(await session.readFile("help.txt")).toContain("Registered commands:");
    expect((await session.run("type help")).exitCode).toBe(0);
  });

  it("seeds an isolated recursive workspace with byte sizes", async () => {
    const session = await createSession();
    expect(session.cwd).toBe("/home");
    const entries = await session.entries();
    expect(entries).toContainEqual({
      path: "/home/examples",
      name: "examples",
      kind: "directory",
      size: 0
    });
    const source = await session.readFile("examples/hello.py");
    expect(entries).toContainEqual({
      path: "/home/examples/hello.py",
      name: "hello.py",
      kind: "file",
      size: new TextEncoder().encode(source).length
    });
    await session.writeFile("examples/hello.py", "edited");
    const reset = await createSession();
    expect(await reset.readFile("examples/hello.py")).toBe(source);
    expect(reset.cwd).toBe("/home");
  });

  it("uses real pipelines, redirects, error statuses, and persistent cwd", async () => {
    const session = await createSession();
    expect(
      await session.run("printf 'pear\\napple\\n' | sort > sorted.txt; cat sorted.txt")
    ).toMatchObject({ stdout: "apple\npear\n", stderr: "", exitCode: 0 });
    expect(await session.readFile("sorted.txt")).toBe("apple\npear\n");
    expect((await session.run("cd examples && false")).exitCode).toBe(1);
    expect(session.cwd).toBe("/home/examples");
    expect((await session.run("pwd")).stdout).toBe("/home/examples\n");
    await session.run("(cd /); printf ok");
    expect(session.cwd).toBe("/home/examples");
    await session.run("cd missing-directory");
    expect(session.cwd).toBe("/home/examples");
    expect((await session.run("command-that-does-not-exist")).exitCode).toBe(127);
  });

  it("resolves cwd-relative, absolute, parent, and home paths", async () => {
    const session = await createSession();
    await session.run("cd examples");
    await session.writeFile("../data/new.txt", "café 世界");
    expect(await session.readFile("~/data/new.txt")).toBe("café 世界");
    expect(await session.isBinary("/home/data/new.txt")).toBe(false);
    await session.remove("../data/new.txt");
    await expect(session.readFile("/home/data/new.txt")).rejects.toThrow();
    await expect(session.writeFile("bad\0name", "no")).rejects.toThrow();
    await expect(session.remove("/")).rejects.toThrow();
    await expect(session.remove("/home")).rejects.toThrow();
  });

  it("preserves uploaded bytes, sanitizes names, and never overwrites collisions", async () => {
    const session = await createSession();
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    const paths = await session.upload([
      { name: "../../photo.bin", data: bytes },
      { name: "C:\\private\\photo.bin", data: bytes },
      { name: "photo.bin", data: bytes },
      { name: "..", data: bytes },
      { name: "bad\n\0name.txt", data: bytes }
    ]);
    expect(paths.slice(0, 3)).toEqual([
      "/home/uploads/photo.bin",
      "/home/uploads/photo-2.bin",
      "/home/uploads/photo-3.bin"
    ]);
    expect(
      paths.every(
        (path) => path.startsWith("/home/uploads/") && !path.includes("\0") && !path.includes("\n")
      )
    ).toBe(true);
    expect(await session.readBytes(paths[0]!)).toEqual(bytes);
    expect(await session.isBinary(paths[0]!)).toBe(true);
    bytes[0] = 99;
    expect((await session.readBytes(paths[0]!))[0]).toBe(0);
    const read = await session.readBytes(paths[0]!);
    read[0] = 98;
    expect((await session.readBytes(paths[0]!))[0]).toBe(0);
  });

  it("prevalidates a whole upload batch and counts UTF-8 edit bytes", async () => {
    const session = await createSession();
    const before = await session.entries();
    await expect(
      session.upload([
        { name: "ok.txt", data: new Uint8Array([1]) },
        { name: "large.bin", data: new Uint8Array(fileLimit + 1) }
      ])
    ).rejects.toThrow("2 MiB");
    expect(await session.entries()).toEqual(before);
    await expect(
      session.writeFile("examples/hello.py", "é".repeat(fileLimit / 2 + 1))
    ).rejects.toThrow("2 MiB");
    expect(await session.entries()).toEqual(before);
    await session.writeFile("boundary.txt", "a".repeat(fileLimit));
    expect((await session.readBytes("boundary.txt")).length).toBe(fileLimit);
  });

  it("rejects workspace overflow atomically and accounts for replacement bytes", async () => {
    const session = await createSession();
    const before = await session.entries();
    await expect(
      session.upload(
        Array.from({ length: 8 }, (_, index) => ({
          name: `large-${index}.bin`,
          data: new Uint8Array(fileLimit)
        }))
      )
    ).rejects.toThrow("16 MiB");
    expect(await session.entries()).toEqual(before);
    const used = before.reduce((total, entry) => total + entry.size, 0);
    await session.upload(
      Array.from({ length: 7 }, (_, index) => ({
        name: `large-${index}.bin`,
        data: new Uint8Array(fileLimit)
      }))
    );
    await session.writeFile("last.txt", "a".repeat(workspaceLimit - used - 7 * fileLimit));
    await session.writeFile("last.txt", "b");
    await expect(session.writeFile("last.txt", "x".repeat(fileLimit))).rejects.toThrow("16 MiB");
    expect(await session.readFile("last.txt")).toBe("b");
  });

  it("completes commands and quoted paths with full command replacements", async () => {
    const session = await createSession();
    await session.upload([
      { name: "read me.txt", data: new Uint8Array() },
      { name: "reader.txt", data: new Uint8Array() }
    ]);
    expect(await session.complete("pw")).toContain("pwd");
    expect(await session.complete("cat examples/he")).toContain("cat examples/hello.py");
    expect(await session.complete('cat "uploads/read m')).toContain('cat "uploads/read me.txt"');
    expect(await session.complete("cat 'uploads/read m")).toContain("cat 'uploads/read me.txt'");
    const completion = (await session.complete("cat uploads/read\\ m"))[0]!;
    expect(completion).toBeTruthy();
    expect((await session.run(completion)).exitCode).toBe(0);
    expect(await session.complete("cd ex")).toContain("cd examples/");
    expect(await session.complete("cat absent/")).toEqual([]);
  });

  it("bounds shell output and recovers for the next command", async () => {
    const session = await createSession();
    expect((await session.run("printf '%100000s' x")).exitCode).not.toBe(0);
    expect((await session.run("echo recovered")).stdout).toBe("recovered\n");
  });

  it("persists cwd when a command exits before the end of its source", async () => {
    const session = await createSession();
    expect((await session.run("cd examples; exit 7")).exitCode).toBe(7);
    expect(session.cwd).toBe("/home/examples");
    expect((await session.run("pwd")).stdout).toBe("/home/examples\n");
    expect((await session.run("(cd /; exit 3)")).exitCode).toBe(3);
    expect(session.cwd).toBe("/home/examples");
    expect((await session.run("move() { cd ../data; }; move; exit 4")).exitCode).toBe(4);
    expect(session.cwd).toBe("/home/data");
    expect((await session.run("cd /home/examples; printf '%100000s' x")).exitCode).not.toBe(0);
    expect(session.cwd).toBe("/home/examples");
  });

  it.each([
    ["(cd examples); pwd", "/home\n", "/home"],
    ["cd examples | cat; pwd", "/home\n", "/home"],
    ["printf x | (cd examples); pwd", "/home\n", "/home"],
    ["move() { cd examples; return 3; }; move; pwd", "/home/examples\n", "/home/examples"],
    ["printf '%s\\n' \"$(cd examples; pwd)\"; pwd", "/home/examples\n/home\n", "/home"]
  ])("preserves only root cwd for %s", async (command, stdout, cwd) => {
    const session = await createSession();
    expect(await session.run(command)).toMatchObject({ stdout, exitCode: 0 });
    expect(session.cwd).toBe(cwd);
    expect((await session.run("pwd")).stdout).toBe(`${cwd}\n`);
  });

  it("preserves root cwd through source return and later syntax errors", async () => {
    const session = await createSession();
    await session.writeFile("move.sh", "cd examples\nreturn 8\ncd /\n");
    expect((await session.run(". ./move.sh")).exitCode).toBe(8);
    expect(session.cwd).toBe("/home/examples");
    const result = await session.run("cd ../data\nif");
    expect(result.exitCode).not.toBe(0);
    expect(session.cwd).toBe("/home/data");
  });

  it.each([
    "cd examples; echo ready > /home/cancellation.txt; while true; do :; done",
    "cd examples; (cd /; echo ready > /home/cancellation.txt; while true; do :; done)"
  ])("preserves acknowledged root cwd on worker termination: %s", async (command) => {
    const session = await createSession();
    const timers = vi.spyOn(globalThis, "setTimeout");
    try {
      const running = session.run(command);
      await vi.waitFor(
        async () => {
          expect(await session.readFile("/home/cancellation.txt")).toBe("ready\n");
        },
        { interval: 1 }
      );
      const timeout = timers.mock.calls.find(([, delay]) => delay === 5000)?.[0];
      if (typeof timeout !== "function") throw new Error("Missing execution timeout");
      timeout();
      expect((await running).exitCode).toBe(124);
      expect(session.cwd).toBe("/home/examples");
      expect((await session.run("pwd")).stdout).toBe("/home/examples\n");
    } finally {
      timers.mockRestore();
    }
  });

  it("does not register or execute an injected cwd sentinel", async () => {
    const session = await createSession();
    expect((await session.run("type __playground_capture_cwd")).exitCode).not.toBe(0);
    expect(await session.run("echo done # leave source unchanged")).toMatchObject({
      stdout: "done\n",
      exitCode: 0
    });
  });

  it("rejects a redirected upload directory before creating any files", async () => {
    const session = await createSession();
    expect((await session.run("rmdir uploads; ln -s /home/data uploads")).exitCode).toBe(0);
    const before = await session.entries();
    await expect(
      session.upload([{ name: "escaped.txt", data: new Uint8Array([1]) }])
    ).rejects.toThrow();
    expect(await session.entries()).toEqual(before);
  });

  it("enforces workspace capacity for real shell copies and redirects", async () => {
    const session = await createSession();
    const used = (await session.entries()).reduce((sum, entry) => sum + entry.size, 0);
    await session.upload(
      Array.from({ length: 7 }, (_, index) => ({
        name: `full-${index}.txt`,
        data: new Uint8Array(fileLimit)
      }))
    );
    await session.writeFile("last.txt", "a".repeat(workspaceLimit - used - 7 * fileLimit));
    expect((await session.run("cp uploads/full-0.txt overflow.txt")).exitCode).not.toBe(0);
    expect((await session.run("printf x >> last.txt")).exitCode).not.toBe(0);
    expect((await session.entries()).reduce((sum, entry) => sum + entry.size, 0)).toBe(
      workspaceLimit
    );
  });

  it("reserves capacity across concurrent edits and upload batches", async () => {
    const session = await createSession();
    const batches = await Promise.all([
      session.upload([{ name: "same.txt", data: new Uint8Array([1]) }]),
      session.upload([{ name: "same.txt", data: new Uint8Array([2]) }])
    ]);
    expect(batches).toEqual([["/home/uploads/same.txt"], ["/home/uploads/same-2.txt"]]);
    expect(await session.readBytes(batches[0]![0]!)).toEqual(new Uint8Array([1]));
    expect(await session.readBytes(batches[1]![0]!)).toEqual(new Uint8Array([2]));
  });

  it("runs the shell sample and keeps other languages as editable source", async () => {
    const session = await createSession();
    const result = await session.run("bash examples/hello.sh");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello, world!");
    expect(result.stdout).toContain("こんにちは世界！");
    expect((await session.run("python examples/hello.py")).exitCode).toBe(127);
  });

  it("executes every welcome-file terminal hint with the supported engine", async () => {
    const session = await createSession();
    const hints = sampleFiles["/home/WELCOME.md"]!.split("\n")
      .filter((line) => line.startsWith("  "))
      .map((line) => line.trim());
    expect(hints).toHaveLength(4);
    for (const hint of hints) {
      expect(await session.run(hint), hint).toMatchObject({ stderr: "", exitCode: 0 });
    }
  });

  it("completes apostrophes safely and does not traverse symlink loops", async () => {
    const session = await createSession();
    await session.writeFile("data/it's here.txt", "safe");
    const candidates = await session.complete("cat 'data/it");
    expect(candidates).toHaveLength(1);
    expect((await session.run(candidates[0]!)).stdout).toBe("safe");
    expect((await session.run("ln -s /home data/loop")).exitCode).toBe(0);
    expect((await session.entries()).filter((entry) => entry.path.includes("loop"))).toHaveLength(
      1
    );
  });

  it("preserves literal backslashes inside double-quoted completion paths", async () => {
    const session = await createSession();
    await session.writeFile("data/back\\slash.txt", "literal");
    const candidates = await session.complete('cat "data/back\\s');
    expect(candidates).toHaveLength(1);
    expect((await session.run(candidates[0]!)).stdout).toBe("literal");
  });

  it("counts every hardlink when an editor changes shared file contents", async () => {
    const session = await createSession();
    await session.writeFile("shared.txt", "old");
    expect((await session.run("ln shared.txt other.txt")).exitCode).toBe(0);
    const used = (await session.entries()).reduce((sum, entry) => sum + entry.size, 0);
    await session.upload(
      Array.from({ length: 7 }, (_, index) => ({
        name: `bulk-${index}.txt`,
        data: new Uint8Array(fileLimit)
      }))
    );
    await session.writeFile("remainder.txt", "a".repeat(workspaceLimit - used - 7 * fileLimit - 1));
    await expect(session.writeFile("shared.txt", "four")).rejects.toThrow("16 MiB");
    expect(await session.readFile("other.txt")).toBe("old");
  });

  it("recovers to a surviving parent after deleting the current directory", async () => {
    const session = await createSession();
    await session.run("cd examples");
    await session.remove(".");
    expect(session.cwd).toBe("/home");
    expect((await session.run("pwd")).stdout).toBe("/home\n");
    await session.run("mkdir temporary; cd temporary; rm -rf ../temporary");
    expect(session.cwd).toBe("/home");
    expect((await session.run("pwd")).stdout).toBe("/home\n");
  });

  it("permits larger shell files only within the workspace budget", async () => {
    const session = await createSession();
    await session.upload([{ name: "large.txt", data: new Uint8Array(fileLimit) }]);
    expect((await session.run("printf x >> uploads/large.txt")).exitCode).toBe(0);
    expect((await session.readBytes("uploads/large.txt")).length).toBe(fileLimit + 1);
    await expect(session.writeFile("uploads/large.txt", "a".repeat(fileLimit + 1))).rejects.toThrow(
      "2 MiB"
    );
  });
});
