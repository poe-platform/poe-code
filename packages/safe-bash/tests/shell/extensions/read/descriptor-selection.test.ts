import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";

for (const entry of [
  { args: "-u3 -u0 value", events: ["validate:3", "validate:0", "borrow:0", "release:0"], value: "first", status: 0 },
  { args: "-u0 -u3 value", events: ["validate:0", "validate:3", "borrow:3"], value: "OLD", status: 1 },
  { args: "-u3 -tINVALID value", events: ["validate:3"], value: "OLD", status: 1 },
  { args: "-u0 -u9 value", events: ["validate:0", "validate:9"], value: "OLD", status: 1 },
  { args: "-u3 bad-name", events: ["validate:3"], value: "OLD", status: 1 },
]) test(`descriptor selection acquisition lifecycle: ${entry.args}`, async context => {
  const events: string[] = [];
  const definition = readExtension();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      let registered = false;
      const input = invocation.input;
      return builtin.execute({ ...invocation,
        registerCleanup(cleanup) { registered = true; invocation.registerCleanup(cleanup); },
        input: {
          observe: input.observe.bind(input),
          validateOpen(descriptor) {
            assert.equal(registered, true);
            events.push(`validate:${descriptor}`);
            invocation.input.validateOpen(descriptor);
          },
          borrow(descriptor) {
            assert.equal(registered, true);
            events.push(`borrow:${descriptor}`);
            const lease = invocation.input.borrow(descriptor);
            return { ...lease, release() { events.push(`release:${descriptor}`); return lease.release(); } };
          },
        },
      });
    } })) };
  } }] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`value=OLD; read ${entry.args} 3>&1; printf '%s:<%s>' "$?" "$value"`, { stdin: Buffer.from("first\nsecond\n") });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${entry.status}:<${entry.value}>`);
  assert.deepEqual(events, entry.events);
});

for (const stage of ["validate", "borrow"] as const) for (const reason of [false, undefined, { readStatus: 1 }]) {
  test(`descriptor selection retains ${stage} failure identity: ${String(reason)}`, async context => {
    const builtin = readExtension().create().builtins[0]!;
    const events: string[] = [];
    let observed: { reason: unknown } | undefined;
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "selection-failure", create: () => ({ builtins: [{ name: "probe", async execute(invocation) {
      try {
        await builtin.execute({ ...invocation, argumentValues: ["-u0", "value"], input: {
          observe() { throw new Error("Unexpected descriptor observation"); },
          validateOpen() { events.push("validate"); if (stage === "validate") throw reason; },
          borrow() { events.push("borrow"); throw reason; },
        } });
      } catch (error) { observed = { reason: error }; }
      return 0;
    } }] }) }] });
    context.after(() => shell.dispose());
    assert.equal((await shell.exec("probe")).exitCode, 0);
    assert.ok(observed);
    assert.equal(observed.reason, reason);
    assert.deepEqual(events, stage === "validate" ? ["validate"] : ["validate", "borrow"]);
  });
}

test("write-only readiness refuses without claiming a readable cursor or blocked result", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [readExtension()] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec("value=OLD; read -t0 -u3 value 3>&1; printf '%s:<%s>' \"$?\" \"$value\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<OLD>");
  assert.equal(result.stderr, "shell: line 1: read: descriptor readiness unavailable through this extension API\n");
});
