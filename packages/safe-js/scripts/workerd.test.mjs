import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("portable interpreter executes in workerd without Node compatibility", { timeout: 30000 }, async () => {
  const result = await build({
    stdin: { resolveDir: new URL("../", import.meta.url).pathname, contents: `
      import * as sdk from "@poe-code/safe-js";
      import { run, makeFsModule, createRootedSourceResolver, dump, restore, parseFsConfig, resolveFsConfig, makeMcpModule, inspectSnapshotMigration, captureHostContext, FileSnapshotBackend } from "@poe-code/safe-js";
      import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
      import { StackContext } from "./dist/platform/context.js";
      import { types, createTrackedProxy } from "./dist/platform/types.js";
      import { attachSignalDumpHandler } from "./dist/runner/signal-dump.js";
      import { makeAgentModule, createSpawnUsageAccumulator, runWithSpawnUsageAccumulator, runHarness, migrateSnapshotFile } from "@poe-code/safe-js";
      export default { async fetch() {
        if (typeof Buffer !== "undefined" || typeof process !== "undefined") throw new Error("Node globals present");
        let onSignal;
        const signals = { on(_name, callback) { onSignal = callback; }, off() { onSignal = undefined; } };
        let snapshot;
        const detach = attachSignalDumpHandler(new Promise(() => {}), {
          process: signals, dumpResult: async () => "checkpoint",
          onSnapshot: value => { snapshot = value; }
        });
        onSignal();
        await Promise.resolve();
        detach();
        if (snapshot !== "checkpoint" || onSignal !== undefined) throw new Error("Portable signal snapshot failed");
        const accumulators = [createSpawnUsageAccumulator(), createSpawnUsageAccumulator()];
        await Promise.all(accumulators.map((accumulator, index) => {
          let attempts = 0;
          const agent = makeAgentModule(async () => {
            await Promise.resolve();
            attempts++;
            return { exitCode: attempts === 1 ? 1 : 0, stdout: "", stderr: "", summary: "done", durationMs: 1,
              usage: { inputTokens: index + 1, outputTokens: 10 } };
          });
          return runWithSpawnUsageAccumulator(accumulator, async () => {
            const resume = captureHostContext();
            await Promise.resolve();
            await resume(() => agent.spawn.retry("codex", { prompt: "mock" }, {
              maxAttempts: 2, backoffMs: 0, isRetryable: () => true
            }));
            await Promise.resolve();
            return resume(() => agent.spawn("codex", { prompt: "mock" }));
          });
        }));
        for (const [index, accumulator] of accumulators.entries()) {
          const usage = accumulator.snapshot();
          if (usage.inputTokens !== 3 * (index + 1) || usage.outputTokens !== 30 || usage.attemptCount !== 3 || usage.spawnCount !== 2)
            throw new Error("Portable concurrent spawn accounting failed");
        }
        await Promise.all([41, 42].map(async expected => {
          const realm = sdk.createRealm({ grants: ["source:nested"], extensions: [sdk.defineExtension({
            manifest: { version: 1, name: "portable-callback", capabilities: ["source:nested"], globals: ["invokeLater"] },
            setup(context) {
              return { globals: { invokeLater: context.nestedOperation(async callback => {
                const resume = sdk.captureHostContext();
                await Promise.resolve();
                return resume(() => context.invokeCallback(callback));
              }) } };
            }
          })] });
          try {
            const result = await realm.evaluate('return invokeLater(async () => { await 0; return ' + expected + '; });');
            if (result.returnValue !== expected) throw new Error("Explicit host callback context failed");
          } finally { await realm.close(); }
        }));
        const context = new StackContext();
        const resume = context.run("first", () => StackContext.snapshot());
        const later = new StackContext();
        await Promise.resolve();
        later.run("second", () => resume(() => {
          if (context.getStore() !== "first" || later.getStore() !== undefined) throw new Error("Context isolation failed");
        }));
        if (context.getStore() !== undefined || later.getStore() !== undefined) throw new Error("Context restoration failed");
        const fake = { get [Symbol.toStringTag]() { throw new Error("Brand getter invoked"); } };
        for (const check of [types.isDate, types.isRegExp, types.isArrayBuffer, types.isDataView,
          types.isMap, types.isBooleanObject, types.isNumberObject, types.isStringObject,
          types.isBigIntObject, types.isSymbolObject]) {
          if (check(fake)) throw new Error("False intrinsic brand");
        }
        if (!types.isProxy(createTrackedProxy({}, {}))) throw new Error("Tracked proxy lost");
        for (const [check, value] of [
          [types.isDate, new Date(0)], [types.isRegExp, /value/],
          [types.isArrayBuffer, new ArrayBuffer(0)], [types.isDataView, new DataView(new ArrayBuffer(0))],
          [types.isMap, new Map()], [types.isBooleanObject, Object(true)],
          [types.isNumberObject, Object(1)], [types.isStringObject, Object("value")],
          [types.isBigIntObject, Object(1n)], [types.isSymbolObject, Object(Symbol("value"))],
          [types.isAsyncFunction, async function() {}], [types.isGeneratorFunction, function*() { yield 1; }],
          [types.isNativeError, new Error("value")]
        ]) if (!check(value)) throw new Error("Trusted intrinsic brand lost");
        if (!types.isPromise(Promise.resolve(1))) throw new Error("Promise brand lost");
        if (typeof inspectSnapshotMigration !== "function") throw new Error("Worker SDK export missing");
        let mcpClosed = 0;
        let mcpInitialized = 0;
        const mcp = makeMcpModule({ servers: { docs: { url: "https://example.test/mcp" } },
          fetch: async (_input, init) => {
            if (init.method === "GET") return new Response(null, { status: 405 });
            if (init.method === "DELETE") { mcpClosed++; return new Response(null, { status: 204 }); }
            const request = JSON.parse(init.body);
            if (request.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: request.id,
              error: { code: -32601, message: "Method not found" } });
            if (request.id === undefined) return new Response(null, { status: 202 });
            if (request.method === "initialize") mcpInitialized++;
            const result = request.method === "initialize" ? {
              protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "worker", version: "1" }
            } : { tools: [{ name: "echo", inputSchema: { type: "object" } }] };
            return Response.json({ jsonrpc: "2.0", id: request.id, result }, { headers: { "mcp-session-id": "worker-" + mcpInitialized } });
          }
        });
        const mcpResult = await run('import { servers } from "mcp"; return await servers.docs.tools();', { modules: { mcp } });
        if (mcpResult.returnValue[0].name !== "echo" || mcpClosed !== 1) throw new Error("Worker MCP lifecycle failed: " + JSON.stringify({ result: mcpResult.returnValue, closed: mcpClosed }));
        await Promise.all([1, 2].map(() => run('import { servers } from "mcp"; return await servers.docs.tools();', { modules: { mcp } })));
        if (mcpInitialized !== 3 || mcpClosed !== 3) throw new Error("Concurrent MCP runs shared resource ownership");
        const mcpRealm = sdk.createRealm({ modules: { mcp } });
        try { await mcpRealm.evaluate('import { servers } from "mcp"; return await servers.docs.tools();'); }
        finally { await mcpRealm.close(); }
        if (mcpInitialized !== 4 || mcpClosed !== 4) throw new Error("Realm MCP cleanup failed");
        const configured = await resolveFsConfig(parseFsConfig(JSON.stringify({
          adapter: { type: "memory" }, root: "/configured", readFileMaxBytes: 128
        })));
        await configured.adapter.mkdir("/configured");
        await configured.adapter.writeFile("/configured/value", new TextEncoder().encode("configured"));
        const configuredResult = await run('import { readFile } from "fs"; return await readFile("/configured/value", "utf8");', {
          modules: { fs: makeFsModule(configured) }
        });
        if (configuredResult.returnValue !== "configured") throw new Error("Portable filesystem configuration failed");
        const supplied = new MemoryFileSystem();
        const registry = new Map([["custom", { validateOptions() {}, create: async () => supplied }]]);
        if ((await resolveFsConfig({ adapter: { type: "custom" } }, { registry })).adapter !== supplied)
          throw new Error("Explicit filesystem registry lost");
        let rejectedReal = false;
        try { await resolveFsConfig({ adapter: { type: "real", options: { root: "/" } } }); }
        catch (error) { rejectedReal = error instanceof TypeError && error.message.includes("Unknown filesystem adapter: real"); }
        if (!rejectedReal) throw new Error("Worker granted ambient filesystem authority");
        await configured.adapter.writeFile("/outside", new TextEncoder().encode("private"));
        await configured.adapter.symlink("/outside", "/configured/escape");
        for (const target of ["/outside", "/configured/../outside", "/configured/escape"]) {
          const denied = await run('import { readFile } from "fs"; try { await readFile(' + JSON.stringify(target) + ', "utf8"); } catch (error) { return error.code; }', {
            modules: { fs: makeFsModule(configured) }
          });
          if (denied.returnValue !== "EACCES") throw new Error("Worker filesystem confinement failed: " + target);
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/value", new TextEncoder().encode("portable 😀"));
        const execution = run('import { readFile } from "fs"; return await readFile("/value", "utf8");', {
          modules: { fs: makeFsModule({ adapter: fs }) }
        });
        const result = await execution;
        if (result.returnValue !== "portable 😀") throw new Error("Filesystem read failed");
        const concurrent = await Promise.all([1, 2].map(value => run(
          'import { value } from "host"; return await value();',
          { modules: { host: { value: async () => { await Promise.resolve(); return value; } } } }
        )));
        if (concurrent[0].returnValue !== 1 || concurrent[1].returnValue !== 2) throw new Error("Concurrent execution mixed results");
        const source = 'return await Promise.resolve(42);';
        const pending = run(source);
        if ((await pending).returnValue !== 42) throw new Error("Promise evaluation failed");
        const saved = JSON.parse(await dump(pending));
        restore(saved, { source });
        await fs.mkdir("/snapshots");
        const backend = new FileSnapshotBackend("/snapshots/value.json", { adapter: fs });
        await backend.write(saved);
        if ((await backend.read()).sourceHash !== saved.sourceHash) throw new Error("Portable snapshot backend changed data");
        await backend.remove();
        if (await backend.read() !== undefined) throw new Error("Portable snapshot removal failed");
        await fs.writeFile("/harness.ajs", new TextEncoder().encode("export default function () { return 42; }"));
        const harness = await runHarness("/harness.ajs", { adapter: fs, modulesFor: () => ({}) });
        if (!harness.ok || harness.returnValue !== 42) throw new Error("Portable harness failed");
        const old = run("return 1;");
        await old;
        const encode = value => new TextEncoder().encode(value);
        await fs.writeFile("/old.ajs", encode("return 1;"));
        await fs.writeFile("/old.json", encode(await dump(old)));
        await fs.writeFile("/new.ajs", encode("return import.meta.migration.count;"));
        const migration = { adapter: fs, cwd: "/", snapshotPath: "old.json", sourcePath: "old.ajs" };
        const { inspection } = await migrateSnapshotFile({ ...migration, inspect: true });
        await fs.writeFile("/plan.json", encode(JSON.stringify({ state: { count: 2 }, reconciliation: {
          checkpointDigest: inspection.checkpointDigest, quiescent: true, calls: []
        }})));
        await migrateSnapshotFile({ ...migration, targetSourcePath: "new.ajs", planPath: "plan.json", outputPath: "next.json" });
        const migrated = JSON.parse(new TextDecoder().decode(await fs.readFile("/next.json")));
        if ((await run("return import.meta.migration.count;", { snapshot: migrated })).returnValue !== 2)
          throw new Error("Portable file migration failed");
        await fs.mkdir("/source");
        await fs.writeFile("/source/value.ajs", new TextEncoder().encode("export const value = 42;"));
        const resolver = await createRootedSourceResolver("/source", fs);
        const imported = await run('export { value } from "./value.ajs";', {
          sourceType: "module", filename: await resolver.entryId(), sourceResolver: resolver
        });
        if (imported.returnValue.value !== 42) throw new Error("Source import failed");
        await fs.writeFile("/outside.ajs", new TextEncoder().encode("export const secret = 1;"));
        await fs.symlink("/outside.ajs", "/source/escape.ajs");
        for (const specifier of ["../outside.ajs", "./escape.ajs"]) {
          if (await resolver(specifier, "/source/entry.ajs", {}) !== undefined)
            throw new Error("Worker source confinement failed: " + specifier);
        }
        return Response.json({ ok: true, exports: Object.keys(sdk).sort() });
      }};
    ` },
    bundle: true, platform: "neutral", format: "esm", conditions: ["workerd"], write: false, tsconfigRaw: {},
  });
  const worker = new Miniflare({ modules: true, script: result.outputFiles[0].text,
    rootPath: new URL("../../../out/", import.meta.url).pathname,
    compatibilityDate: "2026-07-08", compatibilityFlags: [],
  });
  try {
    const response = await worker.dispatchFetch("http://fixture/");
    const body = await response.text();
    assert.equal(response.status, 200, body);
    assert.deepEqual(JSON.parse(body), { ok: true, exports: Object.keys(await import("../dist/index.js")).sort() });
  } finally { await worker.dispose(); }
});
