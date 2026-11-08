import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { Capture } from "../../src/shell/runtime.js";

test("scratch captures own bytes across interleaved writes", () => {
  const first = new Capture();
  const second = new Capture();
  first.enableScratchBuffer();
  second.enableScratchBuffer();
  first.writeSync(new TextEncoder().encode("first"));
  second.writeSync(new TextEncoder().encode("second"));
  assert.equal(first.takeUtf8Output(), "first");
  assert.equal(second.takeUtf8Output(), "second");
});

for (const redirect of ["", " >&2"]) {
  test(`warmed shell output survives another tenant during suspension${redirect}`, async context => {
    const a = { shell: new Shell({ fs: new MemoryFileSystem() }) };
    const b = { shell: new Shell({ fs: new MemoryFileSystem() }) };
    for (const tenant of [a, b]) {
      for (const command of basicCommands()) tenant.shell.commands.register(command);
      context.after(() => tenant.shell.dispose());
    }
    let suspend = false;
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const resumed = new Promise<void>(resolve => { resume = resolve; });
    a.shell.commands.register({ name: "pause", async execute() {
      if (suspend) { enter(); await resumed; }
      return { exitCode: 0 };
    } });
    const source = `echo TENANT_A_START${redirect}\npause\necho TENANT_A_END${redirect}`;
    await a.shell.exec(source);
    await b.shell.exec(`echo TENANT_B_OVERWRITE________________${redirect}`);
    await a.shell.exec("");
    await b.shell.exec("");
    suspend = true;
    const pending = a.shell.exec(source);
    await entered;
    try { await b.shell.exec(`echo TENANT_B_OVERWRITE________________${redirect}`); }
    finally { resume(); }
    const result = await pending;
    assert.equal(redirect ? result.stderr : result.stdout, "TENANT_A_START\nTENANT_A_END\n");
    assert.equal(redirect ? result.stdout : result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("warmed results and their bytes are owned by each invocation and tenant", async context => {
  const tenants = [new Shell({ fs: new MemoryFileSystem() }), new Shell({ fs: new MemoryFileSystem() })];
  for (const tenant of tenants) {
    for (const command of basicCommands()) tenant.commands.register(command);
    context.after(() => tenant.dispose());
    await tenant.exec("echo same");
    await tenant.exec("");
  }
  const first = await tenants[0]!.exec("echo same");
  first.stdoutBytes.fill(120);
  Object.assign(first, { stdout: "changed", exitCode: 42 });
  for (const tenant of tenants) {
    await tenant.exec("");
    const next = await tenant.exec("echo same");
    assert.notEqual(next, first);
    assert.equal(next.stdout, "same\n");
    assert.equal(new TextDecoder().decode(next.stdoutBytes), "same\n");
    assert.equal(next.exitCode, 0);
  }
});
