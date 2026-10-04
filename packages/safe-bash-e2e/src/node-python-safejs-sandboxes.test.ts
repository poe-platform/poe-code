import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { sb, withE2EHarness } from "./harness.js";
import { nodeCommands, NODE_PROFILE, type NodeSafeJsCommandOptions, type NodeRuntimeProvider, type NodeHostRequest } from "@poe-platform/safe-bash/commands/node";
import {
  createPythonExecutorPool,
  inspectPythonCapabilities,
  pythonCommands,
  type PythonExecutorStart,
} from "@poe-platform/safe-bash/commands/python";
import { createPlaywrightCli, type PlaywrightAdapter, type PlaywrightPage } from "@poe-platform/safe-bash/commands/playwright";

type SafeJsRuntime<Budget> = NodeSafeJsCommandOptions<Budget>["runtime"];
type SafeJsHostFunction = Parameters<SafeJsRuntime<unknown>["declareHostOperation"]>[0];
type SafeJsModule = ReturnType<SafeJsRuntime<unknown>["makeFsModule"]>;
type SafeJsRunOptions<Budget> = Parameters<SafeJsRuntime<Budget>["run"]>[1];

interface MockBudget {
  readonly maxSteps?: number;
  readonly deadline?: number;
  readonly maxCallDepth?: number;
  readonly stringLength?: number;
  readonly arrayLength?: number;
  readonly dataSize?: number;
}

function createInMemorySafeJsRuntime(meta?: SafeJsRuntime<MockBudget>["node"]): SafeJsRuntime<MockBudget> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();

  const declareHostOperation = <Operation extends SafeJsHostFunction>(
    operation: Operation,
    _policy: "read-side-effect",
    _options?: { readonly awaitResult?: boolean },
  ): Operation => operation;

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
    ...(meta ? { node: meta } : { node: { version: "v22.0.0-safejs", options: { "--trace-warnings": "boolean", "--max-old-space-size": "value" } } }),
    createBudget: (options) => ({ ...options }),
    declareHostOperation,
    parseSourceModule(source: string, filename: string) {
      const cleaned = source.replace(/^\uFEFF/, "").replace(/^#![^\n]*\n?/, "");
      new vm.Script(
        cleaned
          .replace(/\bimport\s+[^;]+;/g, "")
          .replace(/\bexport\s+(default\s+|const\s+|let\s+|function\s+)/g, "const "),
        { filename },
      );
    },
    makeFsModule({ adapter, cwd = "/workspace", signal }) {
      const resolve = (p: unknown) => sb.resolvePath(cwd, String(p));
      return {
        readFile: async (p: unknown, enc?: unknown) => {
          const bytes = await adapter.readFile(resolve(p), { signal });
          if (enc === "utf8" || enc === "utf-8" || (typeof enc === "object" && enc !== null && (enc as { encoding?: string }).encoding === "utf8")) {
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
          const recursive = typeof opts === "object" && opts !== null && Boolean((opts as { recursive?: boolean }).recursive);
          await adapter.mkdir(resolve(p), { recursive, signal });
        },
        readdir: async (p: unknown) => {
          const entries = await adapter.readdir(resolve(p), { signal });
          return entries.map((e) => e.name);
        },
        stat: async (p: unknown) => {
          const st = await adapter.stat(resolve(p), { signal });
          return { size: st.size, isFile: () => st.type === "file", isDirectory: () => st.type === "directory" };
        },
      } as unknown as SafeJsModule;
    },
    async run(source: string, options: SafeJsRunOptions<MockBudget>) {
      options.signal.throwIfAborted();
      if (options.budget.maxSteps !== undefined && options.budget.maxSteps <= 1000 && source.includes("while (true)")) {
        const err = Object.assign(new Error("Execution step budget exceeded"), { code: "budgetExceeded" });
        return { ok: false as const, error: err };
      }
      const bindings = { ...options.bindings } as Record<string, unknown>;
      const asyncModuleRead = bindings.__safeBashModuleRead as ((p: string) => Promise<string>) | undefined;
      const modulePath = bindings.__safeBashModulePath as ((base: string, name: string) => string | null) | undefined;
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
            // Let guest require surface MODULE_NOT_FOUND or limit errors if needed
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
            throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });
          }
          return hit;
        };
      }
      const contextObj: Record<string, unknown> = {
        console: {
          log: (...args: unknown[]) => options.sink.log(...args.map(normalizeRealmValue)),
          error: (...args: unknown[]) => options.sink.error(...args.map(normalizeRealmValue)),
        },
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

describe("safe-bash E2E: node, safejs, python, and playwright-cli sandboxed execution bridges", () => {
  it("1. node -e and node -p evaluate expressions, print JSON objects, write to stderr, and set process.exitCode", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node -p '21 * 2'",
            "node -p '({ service: \"safe-bash\", ok: true })'",
            "node -e 'console.log(\"out-line\"); console.error(\"err-line\"); process.exitCode = 5;' 2>/workspace/err.txt || echo \"exit:$?\"",
            "cat /workspace/err.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "42",
            '{"service":"safe-bash","ok":true}',
            "out-line",
            "exit:5",
            "err-line",
            "",
          ].join("\n")
        );
      }
    );
  });

  it("2. node executes virtual script files with process.argv, process.cwd(), and --env-file / --env-file-if-exists", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/.env.prod": "APP_ENV=production\nAPI_PORT=9090\n",
          "/workspace/scripts/inspect.js": [
            "console.log(JSON.stringify({",
            "  argv: process.argv,",
            "  cwd: process.cwd(),",
            "  dirname: __dirname,",
            "  appEnv: process.env.APP_ENV,",
            "  port: process.env.API_PORT,",
            "}));",
          ].join("\n"),
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          "node --env-file=/workspace/.env.prod --env-file-if-exists=/workspace/.env.missing /workspace/scripts/inspect.js --flag alpha | jq -c ."
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
          argv: ["/virtual/bin/node", "/workspace/scripts/inspect.js", "--flag", "alpha"],
          cwd: "/workspace",
          dirname: "/workspace/scripts",
          appEnv: "production",
          port: "9090",
        });
      }
    );
  });

  it("3. node reads program source from stdin (node -) vs reading guest stdin data via process.stdin.readText()", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "printf 'console.log(\"from-stdin-source:\", 6 * 7);\\n' | node -",
            "printf '{\"items\":[10,20,30]}' | node -e 'const raw = await process.stdin.readText(); const parsed = JSON.parse(raw); console.log(\"sum=\" + parsed.items.reduce((a, b) => a + b, 0));'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "from-stdin-source: 42\nsum=60\n");
      }
    );
  });

  it("4. node accesses VFS via require('node:fs/promises') and require('node:path') to read, transform, and write files", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/input/users.json": '[{"name":"alice"},{"name":"bob"}]\n',
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node -e '",
            "  const fs = require(\"node:fs/promises\");",
            "  const path = require(\"node:path\");",
            "  const src = path.join(process.cwd(), \"input\", \"users.json\");",
            "  const users = JSON.parse(await fs.readFile(src, \"utf8\"));",
            "  await fs.mkdir(\"/workspace/output\", { recursive: true });",
            "  const names = users.map(u => u.name.toUpperCase()).join(\",\") + \"\\n\";",
            "  await fs.writeFile(\"/workspace/output/names.txt\", names);",
            "  console.log(path.basename(src), path.extname(src), path.relative(\"/workspace\", src));",
            "'",
            "cat /workspace/output/names.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["users.json .json input/users.json", "ALICE,BOB", ""].join("\n")
        );
      }
    );
  });

  it("5. node supports --require (-r) preloads and virtual JSON module loading", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/preload.cjs": "globalThis.PRELOADED_TAG = 'bootstrapped-v1';\n",
          "/workspace/pkg.json": '{"name":"safe-app","version":"3.1.0"}\n',
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          "node --require ./preload.cjs -e 'const pkg = require(\"./pkg.json\"); console.log(globalThis.PRELOADED_TAG + \":\" + pkg.name + \"@\" + pkg.version);'"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "bootstrapped-v1:safe-app@3.1.0\n");
      }
    );
  });

  it("6. node --check (-c) validates syntax without executing side effects and rejects conflicting selectors", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        files: {
          "/workspace/valid.js": "console.log('should-not-run');\n",
          "/workspace/broken.js": "const x = ;\n",
        },
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node --check /workspace/valid.js && echo 'valid-syntax-ok'",
            "node -c /workspace/broken.js 2>/dev/null || echo \"broken-exit:$?\"",
            "node -c -e '1+1' 2>/dev/null || echo \"conflict-exit:$?\"",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["valid-syntax-ok", "broken-exit:1", "conflict-exit:2", ""].join("\n")
        );
      }
    );
  });

  it("7. node guest Buffer and TextEncoder support hex, base64, base64url, utf8, and slice views", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        plugins: [sb.nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node -e '",
            "  const b1 = Buffer.from(\"hello\", \"utf8\");",
            "  const b2 = Buffer.from(\"20776f726c64\", \"hex\");",
            "  const joined = Buffer.concat([b1, b2]);",
            "  console.log(joined.toString(\"utf8\"));",
            "  console.log(joined.toString(\"base64\"));",
            "  console.log(Buffer.isBuffer(joined), Buffer.byteLength(\"✓\", \"utf8\"));",
            "'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["hello world", "aGVsbG8gd29ybGQ=", "true 3", ""].join("\n")
        );
      }
    );
  });

  it("8. node drains setTimeout timers before exit and enforces maxSourceBytes, maxOutputBytes, and maxSteps limits (exit 124)", async () => {
    const runtime = createInMemorySafeJsRuntime();
    await withE2EHarness(
      {
        plugins: [
          sb.nodeCommands({
            runtime,
            limits: { maxSourceBytes: 128, maxOutputBytes: 32, maxSteps: 500 },
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node -e 'const t = setTimeout(() => console.log(\"bad\"), 50); clearTimeout(t); setTimeout(() => console.log(\"timer-ok\"), 5);'",
            "node -e 'console.log(\"x\".repeat(100))' 2>/dev/null || echo \"output-limit:$?\"",
            "node -e 'while (true) {}' 2>/dev/null || echo \"step-limit:$?\"",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["timer-ok", "output-limit:124", "step-limit:124", ""].join("\n")
        );
      }
    );
  });

  it("9. nodeCommands registers an injected SafeJS runtime with --version and --completion-bash support", async () => {
    const runtime = createInMemorySafeJsRuntime({
      version: "v22.9.0-custom",
      options: { "--inspect-brk": "boolean" },
    });
    await withE2EHarness(
      {
        plugins: [nodeCommands({ runtime, replace: true })],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node --version",
            "node --completion-bash | grep -o -- '--inspect-brk'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "v22.9.0-custom\n--inspect-brk\n");
      }
    );
  });

  it("10. node with NodeRuntimeProvider (NODE_PROFILE) enforces granular VFS grants (dataRead, dataWrite, jsonModules, stdoutWrite)", async () => {
    const provider: NodeRuntimeProvider = {
      profile: NODE_PROFILE,
      identity: "e2e-sync-provider",
      prepare(request, services) {
        return {
          async start() {
            let seq = 0;
            const callHost = async (
              op: NodeHostRequest["op"],
              authority: NodeHostRequest["authority"],
              path: string | null,
              flag: NodeHostRequest["flag"],
              text: string | null,
              moduleKey: NodeHostRequest["moduleKey"],
            ) => {
              const s = ++seq;
              const res = await services.request({ sequence: s, op, authority, path, flag, text, moduleKey });
              services.delivered(s);
              return res;
            };

            if (request.source.includes("READ_WRITE_FLOW")) {
              const readRes = await callHost("readText", "data", "/workspace/in.txt", "r", null, null);
              const upper = (readRes.text ?? "").toUpperCase();
              await callHost("writeText", "data", "/workspace/out.txt", "w", upper, null);
              await callHost("writeOutput", "stdout", null, null, `provider-wrote:${upper}`, null);
            } else if (request.source.includes("TRY_DENIED_WRITE")) {
              const writeRes = await callHost("writeText", "data", "/workspace/forbidden.txt", "w", "nope", null);
              await callHost("writeOutput", "stdout", null, null, `write-kind:${writeRes.kind}\n`, null);
            }
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
        files: { "/workspace/in.txt": "hello provider\n" },
        plugins: [
          nodeCommands({
            provider,
            grants: { dataRead: true, dataWrite: true, stdoutWrite: true },
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node -e 'READ_WRITE_FLOW'",
            "cat /workspace/out.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "provider-wrote:HELLO PROVIDER\nHELLO PROVIDER\n");
      }
    );

    await withE2EHarness(
      {
        plugins: [
          nodeCommands({
            provider,
            grants: { dataRead: true, dataWrite: false, stdoutWrite: true },
            replace: true,
          }),
        ],
      },
      async (h) => {
        const r = await h.exec("node -e 'TRY_DENIED_WRITE'");
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "write-kind:denied\n");
      }
    );
  });

  it("11. python and python3 execute -c, -m, and script files via PythonAsyncExecutor with argv/cwd/env propagation", async () => {
    const encoder = new TextEncoder();
    await withE2EHarness(
      {
        files: {
          "/workspace/job.py": "print('job')\n",
        },
        plugins: [
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const summary = JSON.stringify({
                  args: start.invocation.args,
                  cwd: start.invocation.cwd,
                  mode: start.invocation.env.PY_MODE ?? null,
                }) + "\n";
                await start.dispatch({ op: "stdout", args: [Array.from(encoder.encode(summary))] });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "PY_MODE=fast python -c 'print(1)' --extra",
            "python3 /workspace/job.py arg1 arg2",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
        assert.deepEqual(lines[0], {
          args: ["-c", "print(1)", "--extra"],
          cwd: "/workspace",
          mode: "fast",
        });
        assert.deepEqual(lines[1], {
          args: ["/workspace/job.py", "arg1", "arg2"],
          cwd: "/workspace",
          mode: null,
        });
      }
    );
  });

  it("12. python executor reads and writes VFS files via open/read/write/close/stat/readdir/mkdir dispatch operations", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    await withE2EHarness(
      {
        files: {
          "/workspace/raw.txt": "alpha\nbeta\ngamma\n",
        },
        plugins: [
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const readHandle = await start.dispatch({
                  op: "open",
                  args: ["/workspace/raw.txt", { access: "read" }],
                });
                const rawBytes = (await start.dispatch({
                  op: "read",
                  args: [readHandle, 1024, 0],
                })) as Uint8Array;
                await start.dispatch({ op: "close", args: [readHandle] });

                const text = decoder.decode(rawBytes);
                const reversed = text.trim().split("\n").reverse().join("\n") + "\n";

                await start.dispatch({ op: "mkdir", args: ["/workspace/py-out", { recursive: true, mode: 0o755 }] });
                const writeHandle = await start.dispatch({
                  op: "open",
                  args: [
                    "/workspace/py-out/reversed.txt",
                    { access: "write", creation: "ifMissing", truncate: true, mode: 0o644 },
                  ],
                });
                await start.dispatch({
                  op: "write",
                  args: [writeHandle, encoder.encode(reversed), 0],
                });
                await start.dispatch({ op: "close", args: [writeHandle] });

                const entries = (await start.dispatch({
                  op: "readdir",
                  args: ["/workspace/py-out"],
                })) as Array<{ name: string }>;
                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode(`entries:${entries.map((e) => e.name).join(",")}\n`))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "python3 -c 'reverse_file()'",
            "cat /workspace/py-out/reversed.txt",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["entries:reversed.txt", "gamma", "beta", "alpha", ""].join("\n")
        );
      }
    );
  });

  it("13. python streams stdin chunks, transforms JSON in a shell pipeline, and writes to stdout", async () => {
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
                const chunks: Uint8Array[] = [];
                while (true) {
                  const chunk = (await start.dispatch({ op: "stdin", args: [4096] })) as number[];
                  if (!chunk || chunk.length === 0) break;
                  chunks.push(Uint8Array.from(chunk));
                }
                const inputText = decoder.decode(Buffer.concat(chunks));
                const rows = inputText
                  .trim()
                  .split("\n")
                  .map((line) => JSON.parse(line) as { id: number; score: number })
                  .filter((r) => r.score >= 80)
                  .map((r) => ({ ...r, grade: "A" }));
                const out = JSON.stringify(rows) + "\n";
                await start.dispatch({ op: "stdout", args: [Array.from(encoder.encode(out))] });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          "printf '{\"id\":1,\"score\":95}\\n{\"id\":2,\"score\":60}\\n{\"id\":3,\"score\":88}\\n' | python3 -c 'filter_scores()' | jq -c '.[]'"
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ['{"id":1,"score":95,"grade":"A"}', '{"id":3,"score":88,"grade":"A"}', ""].join("\n")
        );
      }
    );
  });

  it("14. python enforces maxConcurrentWorkers, emits onProgress phases, and sanitizes host errors via onDiagnostic", async () => {
    const phases: string[] = [];
    const diagnostics: string[] = [];
    let shouldThrow = true;

    await withE2EHarness(
      {
        plugins: [
          pythonCommands({
            replace: true,
            maxConcurrentWorkers: 1,
            onProgress(ev) {
              phases.push(`${ev.command}:${ev.phase}`);
            },
            onDiagnostic(ev) {
              diagnostics.push(ev.failure.category);
            },
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                if (shouldThrow) {
                  shouldThrow = false;
                  throw new Error("https://admin:SUPER_SECRET_PASS@internal.db.local/fail");
                }
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "python3 -c 'boom()' 2>/workspace/py-err.txt || echo \"first-exit:$?\"",
            "python3 -c 'ok()' && echo 'second-ok'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout, "first-exit:1\nsecond-ok\n");
        const errText = await h.readText("/workspace/py-err.txt");
        assert.ok(!errText.includes("SUPER_SECRET_PASS"));
        assert.deepEqual(phases, [
          "python3:initializing",
          "python3:ready",
          "python3:finished",
          "python3:initializing",
          "python3:ready",
          "python3:finished",
        ]);
        assert.equal(diagnostics.length, 1);
      }
    );
  });

  it("15. inspectPythonCapabilities and createPythonExecutorPool manage bounded reusable executor lifecycles", async () => {
    let created = 0;
    let disposed = 0;
    const pool = createPythonExecutorPool({
      maxConcurrentExecutors: 2,
      createExecutor: () => {
        created++;
        return {
          async run(start: PythonExecutorStart) {
            start.onReady();
            await start.dispatch({
              op: "stdout",
              args: [Array.from(new TextEncoder().encode(`pool-exec-${created}\n`))],
            });
            return 0;
          },
          async terminate() {
            disposed++;
          },
        };
      },
    });

    const report = inspectPythonCapabilities({ createExecutor: pool.createExecutor });
    assert.equal(report.configurationValid, true);
    assert.equal(pool.inspect().capacity, 2);

    try {
      await withE2EHarness(
        {
          plugins: [pythonCommands({ createExecutor: pool.createExecutor, replace: true })],
        },
        async (h) => {
          const r = await h.exec(
            [
              "python --help-packages | head -n 1",
              "python3 -c 'run1()'",
              "python3 -c 'run2()'",
            ].join("\n")
          );
          assert.equal(r.exitCode, 0, r.stderr);
          assert.ok(r.stdout.includes("pool-exec-1"));
        }
      );
    } finally {
      await pool.dispose();
    }
    assert.ok(disposed >= 1);
  });

  it("16. playwright-cli manages named browser sessions (-s / PLAYWRIGHT_CLI_SESSION), list, close, and close-all", async () => {
    const openedSessions: string[] = [];
    const visitedUrls: string[] = [];
    let releasedCount = 0;

    const adapter: PlaywrightAdapter = {
      browsers: { chromium: { headed: false } },
      async acquire(request) {
        openedSessions.push(request.session);
        let currentUrl = "about:blank";
        const page = {
          goto: async (url: string) => {
            currentUrl = url;
            visitedUrls.push(`${request.session}:${url}`);
          },
          url: () => currentUrl,
        } as PlaywrightPage;
        return {
          context: {
            newPage: async () => page,
            pages: () => [page],
            close: async () => {},
            on() {},
            off() {},
          },
          onClosed() {
            return () => {};
          },
          async release() {
            releasedCount++;
          },
        };
      },
    };

    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness(
        {
          plugins: [cli.plugin],
        },
        async (h) => {
          const r = await h.exec(
            [
              "playwright-cli open https://app.example.test/login > /dev/null",
              "playwright-cli -s=admin open https://app.example.test/admin > /dev/null",
              "playwright-cli --json list | jq -c '[.browsers[].name]'",
              "playwright-cli close-all > /dev/null",
              "playwright-cli --json list | jq -c '.browsers'",
            ].join("\n")
          );
          assert.equal(r.exitCode, 0, r.stderr);
          assert.equal(r.stdout, '["default","admin"]\n[]\n');
          assert.deepEqual(openedSessions, ["default", "admin"]);
          assert.deepEqual(visitedUrls, [
            "default:https://app.example.test/login",
            "admin:https://app.example.test/admin",
          ]);
          assert.equal(releasedCount, 2);
        }
      );
    } finally {
      await cli.dispose();
    }
  });

  it("17. playwright-cli custom abilities read VFS inputs, write VFS artifacts, and support --json and --raw output", async () => {
    const cli = createPlaywrightCli({
      replace: true,
      abilities: {
        "webmcp-list": {
          async execute(request) {
            const cfg = new TextDecoder().decode(await request.readFile("mcp-tools.json"));
            await request.writeArtifact(
              new TextEncoder().encode(`audit:${cfg.trim()}\n`),
              ".playwright-cli/mcp-audit.txt",
            );
            return {
              sections: [{ title: "Result", content: cfg.trim() }],
            };
          },
        },
      },
    });

    try {
      await withE2EHarness(
        {
          files: {
            "/workspace/mcp-tools.json": '["search_docs","run_query"]\n',
          },
          plugins: [cli.plugin],
        },
        async (h) => {
          const r = await h.exec(
            [
              "playwright-cli --raw webmcp-list",
              "playwright-cli --json webmcp-list | jq -r '.result'",
              "cat /workspace/.playwright-cli/mcp-audit.txt",
            ].join("\n")
          );
          assert.equal(r.exitCode, 0, r.stderr);
          assert.equal(
            r.stdout,
            [
              '["search_docs","run_query"]',
              '["search_docs","run_query"]',
              'audit:["search_docs","run_query"]',
              "",
            ].join("\n")
          );
        }
      );
    } finally {
      await cli.dispose();
    }
  });

  it("18. playwright-cli captures screenshots into VFS files and reports generated Playwright code", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const adapter: PlaywrightAdapter = {
      browsers: { chromium: { headed: false } },
      async acquire() {
        let currentUrl = "https://app.example.test";
        const page = {
          goto: async (url: string) => {
            currentUrl = url;
          },
          url: () => currentUrl,
          title: async () => "Dashboard",
          evaluate: async () => ({ width: 1280, height: 720 }),
          screenshot: async () => fakePng,
        } as unknown as PlaywrightPage;
        return {
          context: {
            newPage: async () => page,
            pages: () => [page],
            close: async () => {},
            on() {},
            off() {},
          },
          onClosed() {
            return () => {};
          },
          async release() {},
        };
      },
    };

    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness(
        {
          plugins: [cli.plugin],
        },
        async (h) => {
          const r = await h.exec(
            [
              "playwright-cli open https://app.example.test/dashboard > /dev/null",
              "playwright-cli screenshot --filename=/workspace/shots/dash.png > /workspace/shot-out.txt",
              "grep -o 'page.screenshot' /workspace/shot-out.txt",
              "xxd -p /workspace/shots/dash.png",
            ].join("\n")
          );
          assert.equal(r.exitCode, 0, r.stderr);
          assert.equal(r.stdout, "page.screenshot\n89504e470d0a1a0a\n");
        }
      );
    } finally {
      await cli.dispose();
    }
  });

  it("19. polyglot ETL pipeline: python3 normalizes CSV, node enriches and signs JSON, and sqlite3 queries final metrics", async () => {
    const runtime = createInMemorySafeJsRuntime();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    await withE2EHarness(
      {
        files: {
          "/workspace/events.csv": "user,amount\nalice,120\nbob,80\nalice,30\n",
        },
        plugins: [
          sb.nodeCommands({ runtime, replace: true }),
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const hRead = await start.dispatch({
                  op: "open",
                  args: ["/workspace/events.csv", { access: "read" }],
                });
                const bytes = (await start.dispatch({
                  op: "read",
                  args: [hRead, 4096, 0],
                })) as Uint8Array;
                await start.dispatch({ op: "close", args: [hRead] });
                const lines = decoder.decode(bytes).trim().split("\n").slice(1);
                const totals = new Map<string, number>();
                for (const line of lines) {
                  const [u, amt] = line.split(",");
                  totals.set(u!, (totals.get(u!) ?? 0) + Number(amt));
                }
                const json = JSON.stringify(
                  [...totals.entries()].map(([user, total]) => ({ user, total })),
                );
                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode(json + "\n"))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "python3 -c 'aggregate_csv()' | node -e '",
            "  const raw = await process.stdin.readText();",
            "  const rows = JSON.parse(raw).map(r => ({ ...r, tier: r.total >= 100 ? \"gold\" : \"silver\" }));",
            "  const sql = rows.map(r => `INSERT INTO tiers VALUES (\\x27${r.user}\\x27, ${r.total}, \\x27${r.tier}\\x27);`).join(\"\\n\") + \"\\n\";",
            "  const fs = require(\"node:fs/promises\");",
            "  await fs.writeFile(\"/workspace/insert.sql\", sql);",
            "'",
            "sqlite3 /workspace/metrics.db 'CREATE TABLE tiers (user TEXT, total INT, tier TEXT);'",
            "sqlite3 /workspace/metrics.db < /workspace/insert.sql",
            "sqlite3 -csv -header /workspace/metrics.db 'SELECT user, total, tier FROM tiers ORDER BY total DESC;'",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          ["user,total,tier", "alice,150,gold", "bob,80,silver", ""].join("\n")
        );
      }
    );
  });

  it("20. polyglot release verification: node generates manifest, python3 verifies files, and tar -cJf archives bundle", async () => {
    const runtime = createInMemorySafeJsRuntime();
    const encoder = new TextEncoder();

    await withE2EHarness(
      {
        files: {
          "/workspace/app/index.js": "export const version = '1.0.0';\n",
          "/workspace/app/schema.sql": "CREATE TABLE items (id INT PRIMARY KEY);\n",
        },
        plugins: [
          sb.nodeCommands({ runtime, replace: true }),
          pythonCommands({
            replace: true,
            createExecutor: () => ({
              async run(start: PythonExecutorStart) {
                start.onReady();
                const entries = (await start.dispatch({
                  op: "readdir",
                  args: ["/workspace/app"],
                })) as Array<{ name: string }>;
                await start.dispatch({
                  op: "stdout",
                  args: [Array.from(encoder.encode(`verified:${entries.map((e) => e.name).sort().join(",")}\n`))],
                });
                return 0;
              },
              async terminate() {},
            }),
          }),
        ],
      },
      async (h) => {
        const r = await h.exec(
          [
            "node -e '",
            "  const fs = require(\"node:fs/promises\");",
            "  const files = (await fs.readdir(\"/workspace/app\")).sort();",
            "  await fs.writeFile(\"/workspace/app/manifest.json\", JSON.stringify({ files, count: files.length }) + \"\\n\");",
            "'",
            "python3 -c 'verify_app()'",
            "tar --sort=name -cJf /workspace/app.tar.xz -C /workspace app",
            "tar -tf /workspace/app.tar.xz",
            "tar -xJf /workspace/app.tar.xz -O app/manifest.json | jq -c .",
          ].join("\n")
        );
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(
          r.stdout,
          [
            "verified:index.js,manifest.json,schema.sql",
            "app/",
            "app/index.js",
            "app/manifest.json",
            "app/schema.sql",
            '{"files":["index.js","schema.sql"],"count":2}',
            "",
          ].join("\n")
        );
      }
    );
  });
});
