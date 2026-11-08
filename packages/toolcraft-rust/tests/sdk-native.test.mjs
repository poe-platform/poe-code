import assert from "node:assert/strict";
import { test } from "node:test";
import { createSDK as native } from "toolcraft-rust/sdk";
import { createSDK as reference } from "../../toolcraft/dist/sdk.js";
import { S, defineCommand, defineGroup, defineStreamCommand, asMCPResult } from "../dist/index.js";

test("native SDK assembles immutable cased members and invokes with original values", async () => {
  for (const create of [native, reference]) {
    const service = {};
    const fetch = async () => {};
    const command = defineCommand({ name: "get-item", params: S.Object({ item_id: S.String() }),
      secrets: { token: { env: "TOKEN" } }, requires: { check(ctx) {
        assert.equal(ctx.params, undefined); assert.equal(ctx.service, service); return { ok: true };
      } }, handler(ctx) {
        assert.equal(this, root.children[0]); assert.equal(ctx.service, service); assert.equal(ctx.fetch, fetch);
        assert.equal(ctx.root, root); assert.equal(ctx.secrets.token, "secret");
        ctx.progress("reading"); return ctx.params;
      } });
    const root = defineGroup({ name: "root", children: [command] });
    const events = [];
    const sdk = create(root, { services: { service }, env: { TOKEN: "secret" }, fetch,
      logLevel: "info", logger: event => events.push(event), errorReports: false });
    assert.deepEqual(Object.keys(sdk), ["getItem"]);
    assert.deepEqual(Object.getOwnPropertyDescriptor(sdk, "getItem"), {
      value: sdk.getItem, enumerable: true, configurable: false, writable: false
    });
    assert.deepEqual(await sdk.getItem({ itemId: "42" }), { item_id: "42" });
    assert.deepEqual(events, [{ level: "info", message: "reading", category: "progress" }]);
    await assert.rejects(sdk.getItem({ wrong: true }), { name: "UserError", message:
      '2 parameter errors:\n  - wrong: Unexpected parameter "wrong". Available: itemId.\n  - itemId: Missing required parameter "itemId".' });
  }
});

test("SDK native invocation preserves typed MCP errors and arbitrary handler failures", async () => {
  for (const create of [native, reference]) {
    for (const failure of [undefined, null, false, Symbol("failure"), { failed: true }]) {
      const command = defineCommand({ name: "fail", params: S.Object({}), handler() { throw failure; } });
      const sdk = create(defineGroup({ name: "root", children: [command] }), { errorReports: false });
      await assert.rejects(sdk.fail(), error => error === failure);
    }
    for (const result of [asMCPResult({ isError: true, content: [{ type: "text", text: "upstream" }] }),
      asMCPResult({ isError: true, content: [], structuredContent: { detail: 42 } }),
      asMCPResult({ isError: true, content: [] })]) {
      const command = defineCommand({ name: "fail", params: S.Object({}), result: S.Json(), handler: () => result });
      const sdk = create(defineGroup({ name: "root", children: [command] }), { errorReports: false });
      await assert.rejects(sdk.fail(), error => error.name === "UserError" && error.cause === result);
    }
  }
});

test("SDK stream creation stays lazy and refreshes secrets on the caller's environment", async () => {
  for (const create of [native, reference]) {
    let calls = 0;
    const env = { TOKEN: "before" };
    const command = defineStreamCommand({ name: "watch", params: S.Object({}), event: S.String(),
      secrets: { token: { env: "TOKEN" } }, async *handler(ctx) {
        calls++; assert.equal(this, root.children[0]); assert.ok(ctx.signal instanceof AbortSignal);
        yield ctx.secrets.token; env.TOKEN = "after";
        yield (await ctx.refreshSecrets()).token;
      } });
    const root = defineGroup({ name: "root", children: [command] });
    const sdk = create(root, { env, errorReports: false });
    const stream = sdk.watch();
    assert.equal(calls, 0);
    const values = [];
    for await (const value of stream) values.push(value);
    assert.deepEqual(values, ["before", "after"]); assert.equal(calls, 1);
  }
});

test("SDK construction and invocation retain option, command and service getter order", async () => {
  const run = async create => {
    const reads = [];
    const observe = (target, prefix) => new Proxy(target, { get(target, key, receiver) {
      reads.push(`${prefix}.${String(key)}`); return Reflect.get(target, key, receiver);
    } });
    const command = observe(defineCommand({ name: "read", params: S.Object({ value: S.String() }),
      handler: ctx => ctx.params }), "command");
    const root = { kind: "group", name: "root", children: [command] };
    const options = observe({ services: observe({ service: true }, "services"), errorReports: false }, "options");
    const sdk = create(root, options);
    const result = await sdk.read({ value: "ok" });
    return { reads, result };
  };
  assert.deepEqual(await run(native), await run(reference));
});

test("SDK invocation retains promise settlement order across requirements and handlers", async () => {
  const run = async (create, handler, check) => {
    const trace = [];
    const command = defineCommand({ name: "read", params: S.Object({}),
      requires: check ? { check: async () => { trace.push("check"); return { ok: true }; } } : undefined,
      handler: () => { trace.push("handler"); return handler(); } });
    const sdk = create(defineGroup({ name: "root", children: [command] }), { errorReports: false });
    const promise = sdk.read().then(() => trace.push("fulfilled"), () => trace.push("rejected"));
    for (let i = 0; i < 10; i++) { trace.push(`tick${i}`); await Promise.resolve(); }
    await promise;
    return trace;
  };
  for (const handler of [() => 1, async () => 2, () => { throw "failure"; }])
    for (const check of [false, true]) assert.deepEqual(await run(native, handler, check), await run(reference, handler, check));
});

test("SDK re-reads params after asynchronous requirements and reports bounded diagnostics", async () => {
  for (const create of [native, reference]) {
    const command = defineCommand({ name: "read", params: S.Object({ before: S.String() }),
      requires: { check: async () => { command.params = S.Object({ after_value: S.Number() }); return { ok: true }; } },
      handler: ctx => ctx.params });
    const root = { kind: "group", name: "root", children: [command] };
    const sdk = create(root, { errorReports: false });
    assert.deepEqual(await sdk.read({ afterValue: 3 }), { after_value: 3 });
    command.requires = undefined;
    command.params = S.Object(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`field${i}`, S.Number()])));
    await assert.rejects(sdk.read(), error => {
      assert.equal(error.name, "UserError");
      assert.ok(error.message.startsWith("12 parameter errors:\n"));
      assert.ok(error.message.endsWith("  … and 2 more"));
      assert.ok(!error.message.includes("field10"));
      return true;
    });
  }
});

test("SDK invokes the supplied approval runtime with its receiver and original command path", async () => {
  for (const create of [native, reference]) {
    const command = defineCommand({ name: "run-task", params: S.Object({}), handler() { throw new Error("must use runtime"); } });
    const root = defineGroup({ name: "root", children: [defineGroup({ name: "sub-group", children: [command] })] });
    const pending = { status: "pending", approvalId: "fixture" };
    const runtime = { invoke(node, context, path) {
      assert.equal(this, runtime); assert.equal(node, root.children[0].children[0]);
      assert.equal(context.root, root); assert.equal(path, "sub-group.run-task"); return pending;
    } };
    const sdk = create(root, { humanInLoop: runtime, errorReports: false });
    assert.equal(await sdk.subGroup.runTask(), pending);
  }
});

test("SDK build errors close child iterators and preserve arbitrary getter throws", () => {
  for (const create of [native, reference]) {
    let closed = 0;
    let iteration = 0;
    const children = { *[Symbol.iterator]() {
      iteration++;
      try { yield defineCommand({ name: "then", params: S.Object({}), handler() {} }); }
      finally { closed++; }
    } };
    assert.throws(() => create({ kind: "group", name: "root", children }), { name: "UserError", message: 'SDK member "then" uses reserved member "then".' });
    assert.equal(closed, iteration);
    for (const failure of [undefined, null, false, Symbol("failure"), { failure: true }]) {
      assert.throws(() => create({ kind: "group", name: "root", children: [] }, { get casing() { throw failure; } }), error => error === failure);
    }
  }
});
