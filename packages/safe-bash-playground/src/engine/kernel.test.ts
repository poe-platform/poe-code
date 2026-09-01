import { beforeAll, describe, expect, it } from "vitest";
import { buildBrowserEngine, safeBashBrowserPlugin } from "./build-plugin.mjs";

describe("real safe-bash browser kernel", () => {
  let kernel: typeof import("./index.js");
  let inputs: string[];

  beforeAll(async () => {
    const built = await buildBrowserEngine();
    inputs = built.inputs;
    kernel = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`
    );
  });

  async function fixture() {
    const fs = kernel.createMemoryFileSystem();
    await fs.mkdir("/home");
    const shell = new kernel.Shell({ fs, cwd: "/home", limits: kernel.browserLimits }).use(
      kernel.browserCommands()
    );
    return { fs, shell };
  }

  it("executes actual shell scripts, pipelines, expansions, and virtual file changes", async () => {
    const { fs, shell } = await fixture();
    try {
      await fs.writeFile(
        "/home/run.sh",
        new TextEncoder().encode(
          "for word in banana apple banana; do echo $word; done | sort | uniq > result.txt\ncat result.txt"
        )
      );
      const result = await shell.exec("sh run.sh");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("apple\nbanana\n");
      expect(new TextDecoder().decode(await fs.readFile("/home/result.txt"))).toBe(result.stdout);
      expect(
        (await shell.exec("mkdir docs; cd docs; printf '%s\\n' \"$(pwd)\"; echo $((2 + 3))")).stdout
      ).toBe("/home/docs\n5\n");
      expect((await shell.exec("printf 'a,b,c\\n' | cut -d, -f2")).stdout).toBe("b\n");
    } finally {
      await shell.dispose();
    }
  });

  it("has no process, network, JavaScript, Python, or worker-backed regex commands", async () => {
    const { shell } = await fixture();
    try {
      for (const command of ["curl", "node", "python", "safejs", "grep", "rg", "sed"]) {
        expect((await shell.exec(command)).exitCode).toBe(127);
      }
      await expect(shell.exec("[[ hello =~ h.* ]]")).rejects.toThrow("unavailable in this browser");
    } finally {
      await shell.dispose();
    }
    expect(
      inputs.some((path) => path.includes("worker_threads") || path.includes("transport/owner.js"))
    ).toBe(false);
    expect(inputs.some((path) => path.includes("/commands/network/"))).toBe(false);
    expect(inputs.some((path) => path.endsWith("/safe-bash/dist/shell/runtime.js"))).toBe(true);
  });

  it("bounds infinite loops and output while allowing browser tasks to run", async () => {
    const { shell } = await fixture();
    try {
      let yielded = false;
      setTimeout(() => {
        yielded = true;
      }, 0);
      await expect(
        shell.exec("while true; do :; done", {
          limits: { maxLoopIterations: 80, maxCommands: 200 }
        })
      ).rejects.toThrow();
      expect(yielded).toBe(true);
      await expect(
        shell.exec("printf '%10000s' x", { limits: { maxOutputBytes: 128 } })
      ).rejects.toThrow();
      const controller = new AbortController();
      controller.abort(new Error("cancelled"));
      await expect(shell.exec("echo nope", { signal: controller.signal })).rejects.toThrow(
        "cancelled"
      );
    } finally {
      await shell.dispose();
    }
  });

  it("bounds oversized format allocations, recursion, and source before execution", async () => {
    const { shell } = await fixture();
    try {
      const oversized = await shell.exec("printf '%999999999999s' x");
      expect(oversized.exitCode).toBe(2);
      expect(oversized.stdout).toBe("");
      expect(oversized.stderr).toContain("format width or precision is too large");
      await expect(shell.exec("recurse(){ recurse; }; recurse")).rejects.toThrow(
        "maxSubstitutionDepth"
      );
      await expect(shell.exec(" ".repeat(16 * 1024 + 1))).rejects.toThrow("maxSourceBytes");
    } finally {
      await shell.dispose();
    }
  });

  it("observes cancellation scheduled while a loop is already executing", async () => {
    const { shell } = await fixture();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("active cancellation")), 15);
    try {
      await expect(
        shell.exec("while :; do :; done", { signal: controller.signal })
      ).rejects.toThrow("active cancellation");
    } finally {
      clearTimeout(timer);
      await shell.dispose();
    }
  });

  it("registers browser adapter sources for live reload", async () => {
    const plugin = safeBashBrowserPlugin();
    const watched: string[] = [];
    const id = plugin.resolveId("virtual:safe-bash-kernel");
    await plugin.load.call({ addWatchFile: (path: string) => watched.push(path) }, id);
    expect(watched.some((path) => path.endsWith("/engine/platform.ts"))).toBe(true);
    expect(watched.some((path) => path.endsWith("/engine/path.ts"))).toBe(true);
  });

  it("reports the final root cwd exactly once when exit skips later commands", async () => {
    const { fs, shell } = await fixture();
    await fs.mkdir("/home/sub");
    const states: Readonly<{ cwd: string }>[] = [];
    try {
      const result = await shell.exec("cd sub; exit 7; cd /", {
        onState: (state) => states.push(state)
      });
      expect(result.exitCode).toBe(7);
      expect(states).toEqual([{ cwd: "/home/sub" }]);
      expect(Object.isFrozen(states[0])).toBe(true);
    } finally {
      await shell.dispose();
    }
  });

  it("does not report child shell, subshell, or pipeline cwd as root state", async () => {
    const { fs, shell } = await fixture();
    await fs.mkdir("/home/sub");
    const states: Readonly<{ cwd: string }>[] = [];
    try {
      const result = await shell.exec("cd sub; (cd /); sh -c 'cd /'; cd / | cat", {
        onState: (state) => states.push(state)
      });
      expect(result.exitCode).toBe(0);
      expect(states).toEqual([{ cwd: "/home/sub" }]);
    } finally {
      await shell.dispose();
    }
  });

  it("reports root state before a budget failure settles", async () => {
    const { fs, shell } = await fixture();
    await fs.mkdir("/home/sub");
    const states: Readonly<{ cwd: string }>[] = [];
    try {
      await expect(
        shell.exec("cd sub; while :; do :; done", {
          limits: { maxLoopIterations: 2 },
          onState: (state) => states.push(state)
        })
      ).rejects.toThrow("maxLoopIterations");
      expect(states).toEqual([{ cwd: "/home/sub" }]);
    } finally {
      await shell.dispose();
    }
  });

  it("keeps root cwd on errexit and scheduled cancellation", async () => {
    const { fs, shell } = await fixture();
    await fs.mkdir("/home/sub");
    const states: Readonly<{ cwd: string }>[] = [];
    try {
      expect(
        (
          await shell.exec("cd sub; set -e; false; cd /", {
            onState: (state) => states.push(state)
          })
        ).exitCode
      ).toBe(1);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("stop root")), 15);
      try {
        await expect(
          shell.exec("cd sub; while :; do :; done", {
            signal: controller.signal,
            onState: (state) => states.push(state)
          })
        ).rejects.toThrow("stop root");
      } finally {
        clearTimeout(timer);
      }
      expect(states).toEqual([{ cwd: "/home/sub" }, { cwd: "/home/sub" }]);
    } finally {
      await shell.dispose();
    }
  });

  it("caps buffered commands at 2 MiB while admitting the exact boundary", async () => {
    const { fs, shell } = await fixture();
    const limit = 2 * 1024 * 1024;
    const bytes = new Uint8Array(limit).fill(120);
    bytes[limit - 1] = 10;
    try {
      await fs.writeFile("/home/boundary.txt", bytes);
      const boundary = await shell.exec("sort -o sorted.txt boundary.txt");
      expect(boundary.exitCode).toBe(0);
      expect((await fs.stat("/home/sorted.txt")).size).toBe(limit);
      await fs.writeFile("/home/oversized.txt", new Uint8Array(limit + 1).fill(120));
      const oversized = await shell.exec("sort -o overflow.txt oversized.txt");
      expect(oversized.exitCode).toBe(2);
      expect(oversized.stderr).toContain("buffer limit exceeded");
      await expect(fs.stat("/home/overflow.txt")).rejects.toThrow();
    } finally {
      await shell.dispose();
    }
  });

  it("advertises exactly the 28 registered browser commands", () => {
    expect(kernel.supportedCommands).toEqual([
      "[",
      "basename",
      "cat",
      "cp",
      "cut",
      "dirname",
      "echo",
      "false",
      "head",
      "ln",
      "ls",
      "mkdir",
      "mv",
      "printf",
      "pwd",
      "readlink",
      "realpath",
      "rm",
      "rmdir",
      "sort",
      "tail",
      "tee",
      "test",
      "touch",
      "tr",
      "true",
      "uniq",
      "wc"
    ]);
    expect(kernel.supportedCommands).toHaveLength(28);
  });
});
