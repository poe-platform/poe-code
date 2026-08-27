import assert from "node:assert/strict";
import { Shell, ShellLimitError, FsError, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { Budget, resolveLimits } from "../../src/shell/runtime.js";
let checks = 0;
const limited = (error: unknown) => error instanceof ShellLimitError && error.limit === "maxOutputBytes";
const bytes = Buffer.from("1234");
{
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 })); let delivered = 0;
  const owned = budget.sink({ async write(chunk) { delivered += chunk.byteLength; } });
  await budget.sink(budget.sink(owned)).write(bytes);
  assert.equal(budget.bytes, 4); assert.equal(delivered, 4);
  await assert.rejects(owned.write(bytes), limited); assert.equal(delivered, 4); checks++;
}
{
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 }));
  const child = new AbortController(); const reason = new FsError("ENOENT", { path: "child" }); let entered = 0;
  const sink = budget.sink(budget.sink({ async write() { entered++; } }), child.signal);
  child.abort(reason); await assert.rejects(sink.write(bytes), error => error === reason);
  assert.equal(entered, 0); assert.equal(budget.bytes, 0); assert.equal(budget.signal.aborted, false); checks++;
}
for (const abortChild of [false, true]) {
  const parent = new AbortController(); const child = new AbortController();
  const reason = new FsError("EACCES", { path: abortChild ? "child-pending" : "parent-pending" });
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 }), parent.signal); let entered = 0;
  const sink = budget.sink(budget.sink({ async write() {
    entered++; setTimeout(() => (abortChild ? child : parent).abort(reason), 0);
    await new Promise((_, reject) => setTimeout(() => reject(new Error("observed late write rejection")), 20));
  } }), child.signal);
  await assert.rejects(sink.write(bytes), error => error === reason);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(entered, 1); assert.equal(budget.bytes, 4); checks++;
}
{
  const budget = new Budget(resolveLimits({ maxOutputBytes: 3 })); let entered = 0;
  const failure = new FsError("EIO", { path: "downstream" });
  const sink = budget.sink(budget.sink({ async write() { entered++; throw failure; } }));
  await assert.rejects(sink.write(bytes), limited); assert.equal(entered, 0); assert.equal(budget.bytes, 0); checks++;
}
{
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 })); let entered = 0;
  const failure = new FsError("EIO", { path: "downstream" });
  const sink = budget.sink(budget.sink({ async write() { entered++; throw failure; } }));
  await assert.rejects(sink.write(bytes), error => error === failure);
  assert.equal(entered, 1); assert.equal(budget.bytes, 4);
  await assert.rejects(sink.write(bytes), limited); assert.equal(entered, 1); checks++;
}
{
  const parent = new Budget(resolveLimits({ maxOutputBytes: 4 }));
  const foreign = new Budget(resolveLimits({ maxOutputBytes: 100 }));
  let entered = 0;
  const sink = parent.sink(foreign.sink({ async write() { entered++; } }));
  await sink.write(bytes); assert.equal(parent.bytes, 4); assert.equal(foreign.bytes, 4); assert.equal(entered, 1); checks++;
}
{
  const budget = new Budget(resolveLimits({ maxOutputBytes: 4 })); let original = 0; let replaced = 0;
  const owned = budget.sink({ async write() { original++; } });
  const forwarded = budget.sink(owned);
  owned.write = async () => { replaced++; };
  await forwarded.write(bytes);
  assert.equal(budget.bytes, 4); assert.equal(original, 1); assert.equal(replaced, 0); checks++;
}
{
  const controller = new AbortController(); const reason = new FsError("ENOENT", { path: "actual-shell" });
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands()); let entered = 0;
  try {
    await assert.rejects(shell.exec("env -i printf 1234", { limits: { maxOutputBytes: 4 }, signal: controller.signal, stdout: { async write() {
      entered++; setTimeout(() => controller.abort(reason), 0);
      await new Promise((_, reject) => setTimeout(() => reject(new Error("late external rejection")), 20));
    } } }), error => error === reason);
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(entered, 1); checks++;
  } finally { await shell.dispose(); }
}
console.log(JSON.stringify({ checks }));
