import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Worker as NodeWorker } from "node:worker_threads";
import { resolveObjectURL } from "node:buffer";
import { buildBrowserEngine, safeBashBrowserPlugin } from "./build-plugin.mjs";

describe("real safe-bash browser kernel", () => {
  let kernel: typeof import("./index.js");
  let inputs: string[];
  const activeWorkers = new Set<{ terminate(): void }>();

  beforeAll(async () => {
    vi.stubGlobal(
      "Worker",
      class extends EventTarget {
        private terminated = false;
        private worker: Promise<NodeWorker>;

        constructor(url: string) {
          super();
          const source = resolveObjectURL(url);
          if (!source) throw new Error("Expected an in-memory worker bundle");
          activeWorkers.add(this);
          this.worker = source.text().then((code) => {
            const worker = new NodeWorker(
              `
            const { parentPort } = require('node:worker_threads');
            globalThis.addEventListener = (event, handler) => parentPort.on(event, data => handler({ data }));
            globalThis.postMessage = (value, transfer) => parentPort.postMessage(value, transfer);
            ${code}
          `,
              { eval: true }
            );
            worker.on("message", (data) =>
              this.dispatchEvent(new MessageEvent("message", { data }))
            );
            worker.on("error", (error) =>
              this.dispatchEvent(Object.assign(new Event("error"), { message: error.message }))
            );
            if (this.terminated) void worker.terminate();
            worker.unref();
            return worker;
          });
        }

        postMessage(value: unknown, transfer: ArrayBuffer[] = []) {
          void this.worker.then((worker) => {
            if (!this.terminated) worker.postMessage(value, transfer);
          });
        }

        terminate() {
          this.terminated = true;
          activeWorkers.delete(this);
          void this.worker.then((worker) => worker.terminate());
        }
      }
    );
    const built = await buildBrowserEngine();
    inputs = built.inputs;
    kernel = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(`${built.code}\n//# sourceURL=safe-bash-browser-kernel.mjs`).toString("base64")}`
    );
  });
  afterAll(() => vi.unstubAllGlobals());
  afterEach(() => expect(activeWorkers.size).toBe(0));

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

  it("keeps host processes, network access, and optional runtimes out of the bundle", async () => {
    const { shell } = await fixture();
    try {
      for (const command of ["curl", "node", "python", "safejs"]) {
        expect((await shell.exec(command)).exitCode).toBe(127);
      }
    } finally {
      await shell.dispose();
    }
    expect(
      inputs.some(
        (path) =>
          path.includes("nodelibs/browser/worker_threads") || path.includes("nodelibs/node/")
      )
    ).toBe(false);
    expect(inputs.some((path) => path.includes("/commands/network/"))).toBe(false);
    expect(inputs.some((path) => path.endsWith("/nodelibs/browser/vm.js") || path.endsWith("/nodelibs/browser/crypto.js"))).toBe(false);
    expect(inputs.some((path) => path.endsWith("/safe-bash/dist/shell/runtime.js"))).toBe(true);
  });

  it("runs the prompt's file reading, search, editing, heredoc, and script workflow", async () => {
    const { shell } = await fixture();
    try {
      const result = await shell.exec(
        "cat > note.txt <<'EOF'\napple\npear\nEOF\nsed -i 's/pear/plum/' note.txt\ngrep '^plum$' note.txt\nfind . -name note.txt\nsed -n '1p' note.txt\nhead -n 1 note.txt"
      );
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: "plum\n./note.txt\napple\napple\n",
        stderr: ""
      });
      expect(await shell.exec("[[ hello =~ ^h.*o$ ]]")).toMatchObject({ exitCode: 0 });
      expect(await shell.exec("printf 'hello\\nbye\\n' | rg '^hello$'")).toMatchObject({
        exitCode: 0,
        stdout: "hello\n",
        stderr: ""
      });
    } finally {
      await shell.dispose();
    }
  });

  it.each([
    ["echo '{\"answer\":42}' | jq .answer", "42\n"],
    ["printf 'one two\\n' | awk '{print $2}'", "two\n"],
    [
      "printf hello | sha256sum",
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  -\n"
    ],
    ["printf hello | gzip | gunzip", "hello"],
    [
      "printf one | gzip > one.gz; printf two | gzip > two.gz; cat one.gz two.gz | gunzip",
      "onetwo"
    ],
    [
      "mkdir docs; echo saved > docs/note; tar -czf saved.tar.gz docs; rm docs/note; tar -xzf saved.tar.gz; cat docs/note",
      "saved\n"
    ],
    ["echo data > note; chmod 600 note; stat -c '%a' note", "600\n"],
    [
      "echo sample > note; cp note copy; diff note copy; printf 'b\\na\\n' | sort | uniq | nl -ba",
      "     1\ta\n     2\tb\n"
    ],
    ["printf hi | base64 | base64 -d", "hi"],
    ["printf 'one two\\n' | xargs printf '%s\\n'", "one\ntwo\n"],
    [
      "printf 'alpha\\nbeta\\n' | egrep '^alpha$'; printf 'a.b\\naxb\\n' | fgrep a.b",
      "alpha\na.b\n"
    ],
    ["expr abc : 'a\\(.*\\)'", "bc\n"],
    ["timeout 1 echo timely", "timely\n"],
    ['name=$(mktemp -p . sample.XXXXXX); test -f "$name" && echo created; rm "$name"', "created\n"],
    ["printf '<h1>Hello</h1>' | html-to-markdown", "# Hello\n"],
    [
      "apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: patched.txt\n+patched\n*** End Patch\nPATCH\ncat patched.txt",
      "Success. Updated the following files:\nA patched.txt\npatched\n"
    ]
  ])("runs browser command pipeline %s", async (source, stdout) => {
    const { shell } = await fixture();
    try {
      expect(await shell.exec(source)).toMatchObject({ exitCode: 0, stdout, stderr: "" });
    } finally {
      await shell.dispose();
    }
  });

  it("rejects damaged compressed input instead of silently accepting it", async () => {
    const { fs, shell } = await fixture();
    try {
      expect((await shell.exec("printf hello | gzip > broken.gz")).exitCode).toBe(0);
      const bytes = await fs.readFile("/home/broken.gz");
      bytes[bytes.length - 8] ^= 1;
      await fs.writeFile("/home/broken.gz", bytes);
      const result = await shell.exec("gunzip -c broken.gz");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("CRC");
    } finally {
      await shell.dispose();
    }
  });

  it("cancels worker-backed searches, releases workers, and keeps the shell usable", async () => {
    const { shell } = await fixture();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("cancelled search")), 30);
    try {
      await expect(
        shell.exec(`printf '${"a".repeat(2000)}' | grep -E '(a+)+b'`, { signal: controller.signal })
      ).rejects.toThrow("cancelled search");
      expect(await shell.exec("echo recovered")).toMatchObject({
        exitCode: 0,
        stdout: "recovered\n"
      });
    } finally {
      clearTimeout(timer);
      await shell.dispose();
    }
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
    expect(watched.some((path) => path.endsWith("/engine/worker-context.mjs"))).toBe(true);
    expect(watched.some((path) => path.endsWith("/engine/workers.mjs"))).toBe(true);
    const assets: { fileName: string; source: string }[] = [];
    await plugin.generateBundle.call({
      emitFile: (asset: { fileName: string; source: string }) => assets.push(asset)
    });
    expect(assets.map((asset) => asset.fileName)).toEqual([
      "safe-bash-engine.LICENSE.txt",
      "browser-platform.LICENSE.txt",
      "browser-hashes.LICENSE.txt"
    ]);
    expect(assets[1]!.source).toContain("Apache License");
    expect(assets[2]!.source).toContain("MIT");
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

  it("registers the full agent command bundle in the browser", () => {
    expect(kernel.supportedCommands).toEqual(
      expect.arrayContaining([
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
        "wc",
        "find",
        "grep",
        "rg",
        "sed",
        "awk",
        "jq",
        "gzip",
        "sha256sum",
        "apply_patch"
      ])
    );
    expect(kernel.supportedCommands).toHaveLength(79);
  });
});
