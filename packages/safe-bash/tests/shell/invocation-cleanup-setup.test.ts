import assert from "node:assert/strict";
import { test } from "node:test";
import type { Middleware, PluginHost, VirtualShellPlugin } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

const pass: Middleware = (_context, next) => next();
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("R1 immediate dispose completes already-queued middleware plugin setup and releases its lease", { timeout: 2000 }, async () => {
  const { shell } = setup();
  let ownedLease = false;
  const events: string[] = [];
  shell.use({ name: "queued", setup(host) {
    events.push("setup-start");
    ownedLease = true;
    host.use(pass);
    events.push("middleware-installed");
  }, dispose() { events.push("plugin-dispose"); ownedLease = false; } });
  await shell.dispose();
  assert.equal(ownedLease, false);
  assert.deepEqual(events, ["setup-start", "middleware-installed", "plugin-dispose"]);
});

test("R1 async admitted setup can register after acquisition without reopening external admission", { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  const entered = deferred();
  const release = deferred();
  let ownedLease = false;
  let disposed = false;
  let externalStarted = false;
  let installed = false;
  shell.use({ name: "async", async setup(host) {
    ownedLease = true;
    entered.resolve();
    await release.promise;
    host.commands.register({ name: "installed", execute() { return { exitCode: 0 }; } });
    host.registerFileSystem("installed", () => fs);
    host.use(pass);
    installed = true;
  }, dispose() { ownedLease = false; } });
  const disposal = shell.dispose().then(() => { disposed = true; });
  await entered.promise;
  try {
    assert.throws(() => shell.use(pass), /disposed/);
    assert.throws(() => shell.use({ name: "external", setup() { externalStarted = true; } }), /disposed/);
    assert.throws(() => shell.register({ name: "external", execute() { externalStarted = true; return { exitCode: 0 }; } }), /disposed/);
    assert.throws(() => shell.registerFileSystem("external", () => fs), /disposed/);
    await assert.rejects(shell.exec("true"), /disposed/);
    await assert.rejects(shell.createFileSystem("installed"), /disposed/);
    await turn();
    assert.equal(disposed, false);
    assert.equal(ownedLease, true);
  } finally { release.resolve(); }
  await disposal;
  assert.equal(installed, true);
  assert.equal(ownedLease, false);
  assert.equal(externalStarted, false);
  assert.equal(shell.commands.has("installed"), true);
});

test("R1 multiple queued asynchronous setups finish before reverse plugin disposal", { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  const release = deferred();
  const events: string[] = [];
  const leases = new Set<string>();
  for (const name of ["first", "second"]) shell.use({ name, async setup(host) {
    events.push(`${name}:start`);
    leases.add(name);
    await release.promise;
    host.use(pass);
    host.registerFileSystem(name, () => fs);
    events.push(`${name}:ready`);
  }, dispose() { events.push(`${name}:dispose`); leases.delete(name); } });
  const disposal = shell.dispose();
  release.resolve();
  await disposal;
  assert.deepEqual(events, ["first:start", "first:ready", "second:start", "second:ready", "second:dispose", "first:dispose"]);
  assert.equal(leases.size, 0);
});

test("R1 saved completed setup hosts do not borrow another setup's disposal admission", { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  let saved!: PluginHost;
  let middlewareCalls = 0;
  shell.use({ name: "completed", setup(host) { saved = host; assert.equal(host.commands, shell.commands); } });
  await shell.exec(":");
  saved.use(async (context, next) => { middlewareCalls++; return next(); });
  saved.registerFileSystem("before", () => fs);
  await shell.exec(":");
  assert.equal(middlewareCalls, 1);
  const entered = deferred();
  const release = deferred();
  let activeCompleted = false;
  shell.use({ name: "active", async setup(host) {
    entered.resolve();
    await release.promise;
    host.use(pass);
    activeCompleted = true;
  } });
  const disposal = shell.dispose();
  await entered.promise;
  try {
    assert.throws(() => saved.use(pass), /disposed/);
    assert.throws(() => saved.registerFileSystem("late", () => fs), /disposed/);
  } finally { release.resolve(); }
  await disposal;
  assert.equal(activeCompleted, true);
  assert.throws(() => saved.use(pass), /disposed/);
});

test("R1 runtime-supported nested plugin setup remains tracked through asynchronous descendants", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const entered = deferred();
  const release = deferred();
  const events: string[] = [];
  const leases = new Set<string>();
  let childEntered = false;
  let disposed = false;
  const grandchild: VirtualShellPlugin = { name: "grandchild", async setup(host) {
    leases.add("grandchild");
    await turn();
    host.use(pass);
    events.push("grandchild:ready");
  }, dispose() { events.push("grandchild:dispose"); leases.delete("grandchild"); } };
  const child: VirtualShellPlugin = { name: "child", async setup(host) {
    leases.add("child");
    childEntered = true;
    entered.resolve();
    await release.promise;
    host.use(pass);
    Reflect.apply(host.use, host, [grandchild]);
    events.push("child:ready");
  }, dispose() { events.push("child:dispose"); leases.delete("child"); } };
  shell.use({ name: "parent", setup(host) {
    leases.add("parent");
    Reflect.apply(host.use, host, [child]);
    events.push("parent:ready");
  }, dispose() { events.push("parent:dispose"); leases.delete("parent"); } });
  const disposal = shell.dispose().then(() => { disposed = true; });
  await Promise.race([entered.promise, disposal]);
  try {
    assert.equal(childEntered, true);
    await turn();
    assert.equal(disposed, false);
  } finally { release.resolve(); }
  await disposal;
  assert.deepEqual(events, ["parent:ready", "child:ready", "grandchild:ready", "grandchild:dispose", "child:dispose", "parent:dispose"]);
  assert.equal(leases.size, 0);
});

for (const reason of [new Error("explicit setup failure"), undefined, null]) {
  test(`R1 preserves explicit setup rejection ${String(reason)} and successful prior disposal`, { timeout: 2000 }, async () => {
    const { shell } = setup();
    const events: string[] = [];
    shell.use({ name: "prior", setup(host) { host.use(pass); events.push("prior:ready"); }, dispose() { events.push("prior:dispose"); } });
    shell.use({ name: "failed", async setup() { await turn(); events.push("failed:setup"); throw reason; }, dispose() { events.push("failed:dispose"); } });
    shell.use({ name: "not-started", setup() { events.push("unexpected:setup"); } });
    let rejected = false;
    await shell.exec(":").then(() => assert.fail("Expected setup rejection"), error => { rejected = true; assert.equal(error, reason); });
    assert.equal(rejected, true);
    await shell.dispose();
    assert.deepEqual(events, ["prior:ready", "failed:setup", "prior:dispose"]);
  });
}

test("R1 immediate dispose preserves explicit failure compatibility after a queued successful setup", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const events: string[] = [];
  shell.use({ name: "prior", setup(host) { host.use(pass); events.push("prior:ready"); }, dispose() { events.push("prior:dispose"); } });
  shell.use({ name: "failed", setup() { events.push("failed:setup"); throw new Error("explicit failure"); }, dispose() { events.push("failed:dispose"); } });
  await shell.dispose();
  assert.deepEqual(events, ["prior:ready", "failed:setup", "prior:dispose"]);
});

test("R1 completed setup disposal still drains reverse callbacks and aggregates exact failure", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const events: string[] = [];
  const reason = new Error("dispose failure");
  shell.use({ name: "first", setup() { events.push("first:ready"); }, dispose() { events.push("first:dispose"); } });
  shell.use({ name: "second", setup() { events.push("second:ready"); }, dispose() { events.push("second:dispose"); throw reason; } });
  const result = await shell.exec(":");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes.length + result.stderrBytes.length, 0);
  const disposal = shell.dispose();
  assert.equal(shell.dispose(), disposal);
  await assert.rejects(disposal, error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0] === reason);
  assert.deepEqual(events, ["first:ready", "second:ready", "second:dispose", "first:dispose"]);
});
