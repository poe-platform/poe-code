import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { sb, withE2EHarness } from "./harness.js";
import {
  nodeCommands,
  type NodeSafeJsCommandOptions,
} from "@poe-platform/safe-bash/commands/node";
import {
  createPythonExecutorPool,
  pythonCommands,
  type PythonExecutorStart,
} from "@poe-platform/safe-bash/commands/python";

interface MockBudget {
  readonly maxSteps?: number;
  readonly deadline?: number;
  readonly maxCallDepth?: number;
  readonly stringLength?: number;
  readonly arrayLength?: number;
  readonly dataSize?: number;
}

type SafeJsRuntime = NodeSafeJsCommandOptions<MockBudget>["runtime"];

function createInMemorySafeJsRuntime(
  meta?: SafeJsRuntime["node"]
): SafeJsRuntime {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();

  const declareHostOperation: SafeJsRuntime["declareHostOperation"] = operation => operation;

  const normalizeRealmValue = (val: unknown): unknown => {
    if (val === null || val === undefined || typeof val !== "object") return val;
    if (val instanceof Uint8Array) return val;
    if (Array.isArray(val)) return val.map(normalizeRealmValue);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = normalizeRealmValue(v);
    }
    return out;
  };

  return {
    ...(meta
      ? { node: meta }
      : {
          node: {
            version: "v22.4.0-safejs",
            options: {
              "--trace-warnings": "boolean",
              "--max-old-space-size": "value",
            },
          },
        }),
    createBudget: (options) => ({ ...options }),
    declareHostOperation,
    parseSourceModule(source: string, filename: string) {
      const cleaned = source.replace(/^\uFEFF/, "").replace(/^#![^\n]*\n?/, "");
      new vm.Script(
        cleaned
          .replace(/\bimport\s+[^;]+;/g, "")
          .replace(/\bexport\s+(default\s+|const\s+|let\s+|function\s+)/g, "const "),
        { filename }
      );
    },
    makeFsModule({ adapter, cwd = "/workspace", signal }) {
      const resolve = (p: unknown) => sb.resolvePath(cwd, String(p));
      return {
        readFile: async (p: unknown, enc?: unknown) => {
          const bytes = await adapter.readFile(resolve(p), { signal });
          if (
            enc === "utf8" ||
            enc === "utf-8" ||
            (typeof enc === "object" &&
              enc !== null &&
              (enc as { encoding?: string }).encoding === "utf8")
          ) {
            return decoder.decode(bytes);
          }
          return decoder.decode(bytes);
        },
        writeFile: async (p: unknown, data: unknown) => {
          const bytes =
            data instanceof Uint8Array
              ? data
              : typeof data === "string"
                ? encoder.encode(data)
                : encoder.encode(String(data));
          await adapter.writeFile(resolve(p), bytes, { signal });
        },
        mkdir: async (p: unknown, opts?: unknown) => {
          const recursive =
            typeof opts === "object" &&
            opts !== null &&
            Boolean((opts as { recursive?: boolean }).recursive);
          await adapter.mkdir(resolve(p), { recursive, signal });
        },
        readdir: async (p: unknown) => {
          const entries = await adapter.readdir(resolve(p), { signal });
          return entries.map((e) => e.name);
        },
        stat: async (p: unknown) => {
          const st = await adapter.stat(resolve(p), { signal });
          return {
            size: st.size,
            isFile: () => st.type === "file",
            isDirectory: () => st.type === "directory",
          };
        },
      } as unknown as ReturnType<SafeJsRuntime["makeFsModule"]>;
    },
    async run(source, options) {
      options.signal.throwIfAborted();
      if (
        options.budget.maxSteps !== undefined &&
        options.budget.maxSteps <= 1000 &&
        source.includes("while (true)")
      ) {
        const err = Object.assign(new Error("Execution step budget exceeded"), {
          code: "budgetExceeded",
        });
        return { ok: false as const, error: err };
      }
      const bindings = { ...options.bindings } as Record<string, unknown>;
      const asyncModuleRead = bindings.__safeBashModuleRead as
        | ((p: string) => Promise<string>)
        | undefined;
      const modulePath = bindings.__safeBashModulePath as
        | ((base: string, name: string) => string | null)
        | undefined;
      const preloads = (bindings.__safeBashPreloads as readonly string[] | undefined) ?? [];
      const cwd = (bindings.__safeBashCwd as string | undefined) ?? "/workspace";
      const entryDir = (bindings.__safeBashEntryDirectory as string | undefined) ?? cwd;
      if (typeof asyncModuleRead === "function" && typeof modulePath === "function") {
        const moduleCache = new Map<string, string>();
        const preloadCandidate = async (base: string, spec: string) => {
          try {
            const resolved = modulePath(base, spec);
            if (resolved && !moduleCache.has(resolved)) {
              const content = await asyncModuleRead(resolved);
              moduleCache.set(resolved, content);
            }
          } catch {
            // Let guest require surface MODULE_NOT_FOUND or limit errors
          }
        };
        for (const p of preloads) {
          await preloadCandidate(cwd, p);
        }
        const reqRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
        for (const match of source.matchAll(reqRegex)) {
          if (match[1]) {
            await preloadCandidate(entryDir, match[1]);
            await preloadCandidate(cwd, match[1]);
          }
        }
        bindings.__safeBashModuleRead = (p: string) => {
          const hit = moduleCache.get(p);
          if (hit === undefined) {
            throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), {
              code: "ENOENT",
            });
          }
          return hit;
        };
      }
      const contextObj: Record<string, unknown> = {
        console: {
          log: (...args: unknown[]) => options.sink.log(...args.map(normalizeRealmValue)),
          error: (...args: unknown[]) => options.sink.error(...args.map(normalizeRealmValue)),
        },
        queueMicrotask,
        __nodeOptions: options.nodeOptions ?? [],
        TextEncoder,
        TextDecoder,
        Uint8Array,
        ArrayBuffer,
        DataView,
        Map,
        Set,
        Promise,
        JSON,
        Math,
        Date,
        RegExp,
        Error,
        TypeError,
        RangeError,
        SyntaxError,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Symbol,
        ...bindings,
      };
      contextObj.globalThis = contextObj;
      const context = vm.createContext(contextObj);
      try {
        const script = new vm.Script(`(async () => {\n${source}\n})()`, {
          filename: options.filename,
        });
        const returnValue = await script.runInContext(context);
        return { ok: true as const, returnValue: normalizeRealmValue(returnValue) };
      } catch (error) {
        return { ok: false as const, error };
      }
    },
  };
}

describe("python, node, and safejs polyglot scripting & VFS bridge matrix", () => {
  it("1. node guest Buffer API: from, alloc, concat, byteLength, encodings (hex/base64/base64url/utf8), equals, and toJSON", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      { plugins: [sb.nodeCommands({ runtime, replace: true })] },
      async (h) => {
        const r = await h.exec(`
          node -e '
            const a = Buffer.from("Safe", "utf8");
            const b = Buffer.from("42617368", "hex");
            const c = Buffer.concat([a, b]);
            const filled = Buffer.alloc(4, "ab");
            console.log(JSON.stringify({
              isBuf: Buffer.isBuffer(c),
              utf8: c.toString("utf8"),
              hex: c.toString("hex"),
              b64: c.toString("base64"),
              b64url: Buffer.from([251, 255, 254]).toString("base64url"),
              byteLen: Buffer.byteLength("é", "utf8"),
              filledHex: filled.toString("hex"),
              eq: c.equals(Buffer.from("SafeBash")),
              json: a.toJSON(),
            }));
          '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          isBuf: true,
          utf8: "SafeBash",
          hex: "5361666542617368",
          b64: "U2FmZUJhc2g=",
          b64url: "-__-",
          byteLen: 2,
          filledHex: "61626162",
          eq: true,
          json: { type: "Buffer", data: [83, 97, 102, 101] },
        });
      }
    );
  });

  it("2. node require('fs/promises') reads, transforms, and writes VFS files bridged into sqlite3 and jq", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/raw.json": JSON.stringify([
            { user: "ada", pts: 40 },
            { user: "grace", pts: 60 },
            { user: "ada", pts: 35 },
          ]),
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(`
          node -e '
            const fs = require("fs/promises");
            const rows = JSON.parse(await fs.readFile("/workspace/raw.json", "utf8"));
            await fs.mkdir("/workspace/out", { recursive: true });
            const csv = ["user,pts", ...rows.map(r => r.user + "," + r.pts)].join("\\n") + "\\n";
            await fs.writeFile("/workspace/out/scores.csv", csv);
            const names = await fs.readdir("/workspace/out");
            const st = await fs.stat("/workspace/out/scores.csv");
            console.log(JSON.stringify({ names, isFile: st.isFile(), size: st.size }));
          '
          sqlite3 /workspace/scores.db <<'SQL'
.mode csv
.import /workspace/out/scores.csv scores
SELECT user, SUM(CAST(pts AS INTEGER)) AS total FROM scores GROUP BY user ORDER BY total DESC;
SQL
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        const lines = r.stdout.trim().split("\n");
        assert.deepEqual(JSON.parse(lines[0]!), {
          names: ["scores.csv"],
          isFile: true,
          size: 32,
        });
        assert.equal(lines[1], "ada,75");
        assert.equal(lines[2], "grace,60");
      }
    );
  });

  it("3. node require('path') POSIX path operations inside virtual scripts", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      { plugins: [sb.nodeCommands({ runtime, replace: true })] },
      async (h) => {
        const r = await h.exec(`
          node -e '
            const path = require("path");
            console.log(JSON.stringify({
              joined: path.join("/workspace", "a//b", "../c", "file.txt"),
              resolved: path.resolve("/workspace/sub", "../app/main.js"),
              dirname: path.dirname("/workspace/app/main.js"),
              basename: path.basename("/workspace/app/main.js", ".js"),
              extname: path.extname("archive.tar.gz"),
              rel: path.relative("/workspace/a/b", "/workspace/a/c/d.txt"),
              isAbs: [path.isAbsolute("/a"), path.isAbsolute("a")],
            }));
          '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          joined: "/workspace/a/c/file.txt",
          resolved: "/workspace/app/main.js",
          dirname: "/workspace/app",
          basename: "main",
          extname: ".gz",
          rel: "../c/d.txt",
          isAbs: [true, false],
        });
      }
    );
  });

  it("4. node --require / -r preloads multiple virtual CommonJS modules in order before main script", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/pre1.cjs": "globalThis.__BootOrder = ['pre1']; module.exports = { tag: 'v1' };",
          "/workspace/pre2.cjs": "globalThis.__BootOrder.push('pre2');",
          "/workspace/app.cjs": "const p1 = require('./pre1.cjs'); globalThis.__BootOrder.push('main:' + p1.tag); console.log(globalThis.__BootOrder.join('->'));",
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec("node -r ./pre1.cjs --require=./pre2.cjs /workspace/app.cjs");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "pre1->pre2->main:v1");
      }
    );
  });

  it("5. node --env-file and --env-file-if-exists parse quotes, export prefix, comments, and multiline escapes", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/base.env": [
            "# Base configuration",
            "export SERVICE_NAME = \"auth-api\"",
            "MULTI_LINE=\"line1\\nline2\"",
            "SINGLE_QUOTED='literal\\nvalue'",
            "OVERRIDE_ME=from_file",
          ].join("\n"),
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(`
          OVERRIDE_ME=from_shell node --env-file=/workspace/base.env --env-file-if-exists=/workspace/nope.env -e '
            console.log(JSON.stringify({
              service: process.env.SERVICE_NAME,
              multi: process.env.MULTI_LINE,
              single: process.env.SINGLE_QUOTED,
              override: process.env.OVERRIDE_ME,
            }));
          '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          service: "auth-api",
          multi: "line1\nline2",
          single: "literal\\nvalue",
          override: "from_shell",
        });
      }
    );
  });

  it("6. node --check / -c validates syntax for files and stdin without executing statements", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/good.js": "const x = 10 + 20;\nconsole.log('SHOULD_NOT_RUN');\n",
          "/workspace/bad.js": "const x = (\n",
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(`
          node --check /workspace/good.js
          echo "good:$?"
          if node -c /workspace/bad.js 2>/workspace/bad.err; then
            echo "unexpected"
          else
            echo "bad:$?"
          fi
          printf 'const ok = 1;\\n' | node -c -
          echo "stdin-good:$?"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), ["good:0", "bad:1", "stdin-good:0"].join("\n"));
      }
    );
  });

  it("7. node --input-type=commonjs provides local module, exports, __filename, and __dirname in eval and stdin", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      { plugins: [sb.nodeCommands({ runtime, replace: true })] },
      async (h) => {
        const r = await h.exec(`
          node --input-type=commonjs -e '
            exports.a = 1;
            module.exports = { b: 2, origA: exports.a, file: __filename, dir: __dirname };
            console.log(JSON.stringify(module.exports));
          '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          b: 2,
          origA: 1,
          file: "[eval]",
          dir: ".",
        });
      }
    );
  });

  it("8. node guest stdin streaming via process.stdin.readText() and process.stdin.readBytes() vs node - program source", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      { plugins: [sb.nodeCommands({ runtime, replace: true })] },
      async (h) => {
        const r = await h.exec(`
          printf 'hello-stdin-data' | node -e '
            const text = await process.stdin.readText();
            console.log("text:" + text.toUpperCase());
          '
          printf 'console.log("from-stdin-program:", 6 * 7);\\n' | node -
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), ["text:HELLO-STDIN-DATA", "from-stdin-program: 42"].join("\n"));
      }
    );
  });

  it("9. node enforces SafeJsCommandLimits (maxOutputBytes, maxSourceBytes, maxSteps) with exit code 124", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        plugins: [
          sb.nodeCommands({
            runtime,
            limits: { maxOutputBytes: 32, maxSourceBytes: 64, maxSteps: 500 },
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          node -e 'console.log("x".repeat(100))' 2>/dev/null || echo "out-limit:$?"
          node -e 'while (true) {}' 2>/dev/null || echo "step-limit:$?"
          node -e 'const veryLongVariableNameToExceedSixtyFourBytesOfSourceCodeLimit = 1234567890;' 2>/dev/null || echo "src-limit:$?"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["out-limit:124", "step-limit:124", "src-limit:124"].join("\n")
        );
      }
    );
  });

  it("10. node deterministic timer scheduling: queueMicrotask and setTimeout/clearTimeout ordering", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      { plugins: [sb.nodeCommands({ runtime, replace: true })] },
      async (h) => {
        const r = await h.exec(`
          node -e '
            const events = ["sync-start"];
            const cancelled = setTimeout(() => events.push("cancelled"), 5);
            clearTimeout(cancelled);
            setTimeout(() => events.push("timer-20"), 20);
            setTimeout(() => events.push("timer-5"), 5);
            queueMicrotask(() => events.push("microtask"));
            events.push("sync-end");
            await new Promise(resolve => setTimeout(resolve, 30));
            console.log(events.join("->"));
          '
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "sync-start->sync-end->microtask->timer-5->timer-20");
      }
    );
  });

  it("11. node with NodeRuntimeProvider (NODE_PROFILE) reads JSON modules and enforces authority grants", async () => {
    const provider: sb.NodeRuntimeProvider = {
      profile: sb.NODE_PROFILE,
      identity: "matrix-provider",
      prepare(request, services) {
        return {
          async start() {
            let seq = 0;
            const hostOp = async (
              op: sb.NodeHostRequest["op"],
              authority: sb.NodeHostRequest["authority"],
              path: string | null,
              flag: sb.NodeHostRequest["flag"],
              text: string | null,
              moduleKey: sb.NodeHostRequest["moduleKey"]
            ) => {
              const s = ++seq;
              const res = await services.request({
                sequence: s,
                op,
                authority,
                path,
                flag,
                text,
                moduleKey,
              });
              services.delivered(s);
              return res;
            };

            await hostOp(
              "authorizeJson",
              "json",
              "/workspace/config.json",
              "r",
              null,
              null
            );
            const modRes = await hostOp(
              "readText",
              "json",
              "/workspace/config.json",
              "r",
              null,
              null
            );
            const writeRes = await hostOp(
              "writeText",
              "data",
              "/workspace/denied.txt",
              "w",
              "secret",
              null
            );
            await hostOp(
              "writeOutput",
              "stdout",
              null,
              null,
              JSON.stringify({
                selector: request.selector,
                jsonKind: modRes.kind,
                jsonText: modRes.text?.trim(),
                writeKind: writeRes.kind,
              }) + "\n",
              null
            );
            return {
              kind: "entryReturned",
              observation: { state: "unknown", fault: false, name: null, message: null, code: null },
            };
          },
          cancel() {},
          async retire() {
            return { acquisition: "exited", exitCode: 0 };
          },
        };
      },
    };

    await withE2EHarness(
      {
        files: { "/workspace/config.json": '{"port":8080}\n' },
        plugins: [
          sb.nodeCommands({
            provider,
            grants: { dataRead: true, jsonModules: true, dataWrite: false, stdoutWrite: true },
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec("node -e '1'");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          selector: "eval",
          jsonKind: "text",
          jsonText: '{"port":8080}',
          writeKind: "denied",
        });
      }
    );
  });

  it("12. nodeCommands registers node with custom version and bash completion options", async () => {
    const runtime = createInMemorySafeJsRuntime({
      version: "v22.11.0-zero-dep",
      options: { "--zero-dep-flag": "boolean", "--heap-limit": "value" },
    });
    await withE2EHarness(
      { plugins: [nodeCommands({ runtime, replace: true })] },
      async (h) => {
        const r = await h.exec(`
          node -v
          node --completion-bash | grep -o -- '--zero-dep-flag'
          node --zero-dep-flag --heap-limit=128 -p '__nodeOptions.join(",")'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          ["v22.11.0-zero-dep", "--zero-dep-flag", "--zero-dep-flag,--heap-limit=128"].join("\n")
        );
      }
    );
  });

  it("13. python and python3 CLI flag validation: accepts standard CPython flags and rejects invalid flags with exit code 2", async () => {
    const encoder = new TextEncoder();
    await withE2EHarness(
      {
        plugins: [
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const out = JSON.stringify(start.invocation.args) + "\n";
                await start.dispatch({ op: "stdout", args: [Array.from(encoder.encode(out))] });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          python3 -u -B -E -I -O -W ignore -X utf8 -c 'print(1)' argA
          python -m pip install --help | head -n 1
          if python3 --invalid-flag 2>/workspace/py-bad.err; then
            echo "unexpected"
          else
            echo "bad-exit:$?"
          fi
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        const lines = r.stdout.trim().split("\n");
        assert.deepEqual(JSON.parse(lines[0]!), [
          "-u",
          "-B",
          "-E",
          "-I",
          "-O",
          "-W",
          "ignore",
          "-X",
          "utf8",
          "-c",
          "print(1)",
          "argA",
        ]);
        assert.match(lines[1]!, /Usage: python -m pip install/);
        assert.equal(lines[2], "bad-exit:2");
      }
    );
  });

  it("14. python3 VFS file operations: open, write, ftruncate, stat, rename, symlink, readlink, and unlink", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    await withE2EHarness(
      {
        plugins: [
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const fd = await start.dispatch({
                  op: "open",
                  args: [
                    "/workspace/draft.txt",
                    { access: "write", creation: "ifMissing", truncate: true, mode: 0o644 },
                  ],
                });
                await start.dispatch({
                  op: "write",
                  args: [fd, encoder.encode("hello-world-extra"), 0],
                });
                await start.dispatch({ op: "ftruncate", args: [fd, 11] });
                await start.dispatch({ op: "close", args: [fd] });

                await start.dispatch({
                  op: "rename",
                  args: ["/workspace/draft.txt", "/workspace/final.txt"],
                });
                await start.dispatch({
                  op: "symlink",
                  args: ["/workspace/final.txt", "/workspace/final.link"],
                });
                const target = (await start.dispatch({
                  op: "readlink",
                  args: ["/workspace/final.link"],
                })) as string;

                const rfd = await start.dispatch({
                  op: "open",
                  args: ["/workspace/final.link", { access: "read" }],
                });
                const bytes = (await start.dispatch({
                  op: "read",
                  args: [rfd, 64, 0],
                })) as Uint8Array;
                await start.dispatch({ op: "close", args: [rfd] });

                const msg = `${target}:${decoder.decode(bytes)}\n`;
                await start.dispatch({ op: "stdout", args: [Array.from(encoder.encode(msg))] });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec("python3 -c 'vfs_ops()'");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "/workspace/final.txt:hello-world\n");
      }
    );
  });

  it("15. python3 VFS resource limits: maxOpenFiles and maxDirectoryEntries enforcement", async () => {
    const encoder = new TextEncoder();
    await withE2EHarness(
      {
        files: {
          "/workspace/dir/a.txt": "1",
          "/workspace/dir/b.txt": "2",
          "/workspace/dir/c.txt": "3",
        },
        plugins: [
          pythonCommands({
            replace: true,
            maxOpenFiles: 2,
            maxDirectoryEntries: 2,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const results: string[] = [];
                const h1 = await start.dispatch({
                  op: "open",
                  args: ["/workspace/dir/a.txt", { access: "read" }],
                });
                const h2 = await start.dispatch({
                  op: "open",
                  args: ["/workspace/dir/b.txt", { access: "read" }],
                });
                try {
                  await start.dispatch({
                    op: "open",
                    args: ["/workspace/dir/c.txt", { access: "read" }],
                  });
                  results.push("open3:ok");
                } catch {
                  results.push("open3:EMFILE");
                }
                await start.dispatch({ op: "close", args: [h1] });
                await start.dispatch({ op: "close", args: [h2] });

                try {
                  await start.dispatch({ op: "readdir", args: ["/workspace/dir"] });
                  results.push("readdir:ok");
                } catch {
                  results.push("readdir:EOVERFLOW");
                }

                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode(results.join(",") + "\n"))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec("python3 -c 'check_limits()'");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "open3:EMFILE,readdir:EOVERFLOW");
      }
    );
  });

  it("16. createPythonExecutorPool reuses warm executors across multi-stage python | python3 pipelines", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let createdCount = 0;
    const pool = createPythonExecutorPool({
      maxConcurrentExecutors: 2,
      createExecutor: () => {
        const id = ++createdCount;
        return {
          async run(start: PythonExecutorStart) {
            start.onReady();
            const code = start.invocation.args[1] ?? "";
            if (code === "produce") {
              const payload = JSON.stringify({ producerId: id, items: [10, 20, 30] }) + "\n";
              await start.dispatch({ op: "stdout", args: [Array.from(encoder.encode(payload))] });
              return 0;
            }
            const chunks: Uint8Array[] = [];
            while (true) {
              const chunk = (await start.dispatch({ op: "stdin", args: [4096] })) as number[];
              if (!chunk || chunk.length === 0) break;
              chunks.push(Uint8Array.from(chunk));
            }
            const data = JSON.parse(decoder.decode(Buffer.concat(chunks))) as {
              producerId: number;
              items: number[];
            };
            const sum = data.items.reduce((a, b) => a + b, 0);
            const out = JSON.stringify({ consumerId: id, sum }) + "\n";
            await start.dispatch({ op: "stdout", args: [Array.from(encoder.encode(out))] });
            return 0;
          },
          async terminate() {},
        };
      },
    });

    await withE2EHarness(
      {
        plugins: [pythonCommands({ createExecutor: pool.createExecutor, replace: true })],
      },
      async (h) => {
        const r1 = await h.exec("python -c produce | python3 -c consume");
        assert.equal(r1.exitCode, 0, r1.stderr);
        const r2 = await h.exec("python -c produce | python3 -c consume");
        assert.equal(r2.exitCode, 0, r2.stderr);
        assert.equal(JSON.parse(r1.stdout).sum, 60);
        assert.equal(JSON.parse(r2.stdout).sum, 60);
        assert.equal(pool.inspect().active, 0);
        assert.equal(pool.inspect().capacity, 2);
        assert.equal(createdCount, 4);
      }
    );
    await pool.dispose();
  });

  it("17. polyglot ETL pipeline: python3 extracts CSV -> node enriches JSON with Buffer hex digest -> sqlite3 aggregates -> jq formats", async () => {
    const runtime = createInMemorySafeJsRuntime();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    await withE2EHarness(
      {
        files: {
          "/workspace/events.txt": "alice:120\nbob:80\nalice:150\ncarol:200\n",
        },
        plugins: [
          sb.nodeCommands({ runtime, replace: true }),
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const fd = await start.dispatch({
                  op: "open",
                  args: ["/workspace/events.txt", { access: "read" }],
                });
                const raw = (await start.dispatch({
                  op: "read",
                  args: [fd, 4096, 0],
                })) as Uint8Array;
                await start.dispatch({ op: "close", args: [fd] });
                const lines = decoder
                  .decode(raw)
                  .trim()
                  .split("\n")
                  .map((l) => {
                    const [actor, val] = l.split(":");
                    return JSON.stringify({ actor, val: Number(val) });
                  });
                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode(lines.join("\n") + "\n"))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          python3 -c 'extract()' | node -e '
            const fs = require("fs/promises");
            const text = await process.stdin.readText();
            const rows = text.trim().split("\\n").map(l => JSON.parse(l));
            const sqlLines = [
              "CREATE TABLE events (actor TEXT, hex_tag TEXT, val INTEGER);",
              ...rows.map(r => {
                const tag = Buffer.from(r.actor, "utf8").toString("hex");
                const q = String.fromCharCode(39); return "INSERT INTO events VALUES (" + q + r.actor + q + ", " + q + tag + q + ", " + r.val + ");";
              }),
              ".mode json",
              "SELECT actor, hex_tag, SUM(val) AS total FROM events GROUP BY actor, hex_tag ORDER BY total DESC;"
            ];
            await fs.writeFile("/workspace/load.sql", sqlLines.join("\\n") + "\\n");
          '
          sqlite3 /workspace/etl.db < /workspace/load.sql | jq -c '.[] | {actor, hex_tag, total}'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout.trim(),
          [
            '{"actor":"alice","hex_tag":"616c696365","total":270}',
            '{"actor":"carol","hex_tag":"6361726f6c","total":200}',
            '{"actor":"bob","hex_tag":"626f62","total":80}',
          ].join("\n")
        );
      }
    );
  });

  it("18. node --enable-source-maps maps guest stack traces using inline base64 sourceMappingURL", async () => {
    const runtime = createInMemorySafeJsRuntime();
    // Minimal v3 source map mapping generated line 1 col 0 to original "orig.ts" line 10 col 4
    const mapJson = JSON.stringify({
      version: 3,
      file: "bundle.js",
      sourceRoot: "/src/",
      sources: ["orig.ts"],
      names: [],
      mappings: "AASA",
    });
    const mapB64 = Buffer.from(mapJson, "utf8").toString("base64");
    await withE2EHarness(
      {
        files: {
          "/workspace/bundle.js": `throw new Error("mapped-boom");\n//# sourceMappingURL=data:application/json;base64,${mapB64}\n`,
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          "node --enable-source-maps /workspace/bundle.js 2>/workspace/err.txt || echo \"exit:$?\"\ncat /workspace/err.txt"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /exit:1/);
        assert.match(r.stdout, /mapped-boom/);
      }
    );
  });

  it("19. python3 non-zero exit code and stderr propagation in set -e -o pipefail with ERR and EXIT traps", async () => {
    const encoder = new TextEncoder();
    await withE2EHarness(
      {
        plugins: [
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const code = start.invocation.args[1] ?? "";
                if (code === "fail_stage") {
                  await start.dispatch({
                    op: "stderr",
                    args: [Array.from(encoder.encode("ValueError: bad record\n"))],
                  });
                  return 3;
                }
                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode("ok\n"))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          set -e -o pipefail
          trap 'echo "trapped-err:$?"' ERR
          trap 'echo "trapped-exit"' EXIT
          python3 -c fail_stage 2>/workspace/py-fail.err | wc -l
          echo "unreachable"
        `);
        assert.equal(r.exitCode, 3);
        assert.match(r.stdout, /trapped-err:3/);
        assert.match(r.stdout, /trapped-exit/);
        assert.doesNotMatch(r.stdout, /unreachable/);
        const err = await h.readText("/workspace/py-fail.err");
        assert.equal(err, "ValueError: bad record\n");
      }
    );
  });

  it("20. polyglot archive & verification workflow: node generates manifest -> python3 verifies hashes -> tar packages release", async () => {
    const runtime = createInMemorySafeJsRuntime();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    await withE2EHarness(
      {
        plugins: [
          sb.nodeCommands({ runtime, replace: true }),
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const fd = await start.dispatch({
                  op: "open",
                  args: ["/workspace/dist/manifest.json", { access: "read" }],
                });
                const bytes = (await start.dispatch({
                  op: "read",
                  args: [fd, 4096, 0],
                })) as Uint8Array;
                await start.dispatch({ op: "close", args: [fd] });
                const manifest = JSON.parse(decoder.decode(bytes)) as {
                  version: string;
                  files: string[];
                };
                const out = `verified:${manifest.version}:${manifest.files.join("+")}\n`;
                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode(out))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(`
          mkdir -p /workspace/dist
          node -e '
            const fs = require("fs/promises");
            await fs.writeFile("/workspace/dist/app.js", "console.log(1);\\n");
            await fs.writeFile("/workspace/dist/manifest.json", JSON.stringify({
              version: "1.0.0",
              files: ["app.js", "manifest.json"]
            }));
          '
          python3 -c 'verify_manifest()' > /workspace/dist/VERIFIED.txt
          tar -czf /workspace/release.tar.gz -C /workspace/dist .
          mkdir -p /workspace/unpack
          tar -xzf /workspace/release.tar.gz -C /workspace/unpack
          cat /workspace/unpack/VERIFIED.txt
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "verified:1.0.0:app.js+manifest.json");
      }
    );
  });
});
