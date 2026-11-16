import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) test(`${runtime} ssh-keygen reports removed host line and retains backup`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const fs = createMemoryFileSystem();
  const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
    : new RustWasmBash({fs, cwd: "/", forceNative: true});
  const original = "oldhost.local ssh-ed25519 AAAAC3\nother.local ssh-ed25519 AAAAC3\n";
  try {
    await fs.writeFile("/known_hosts", Buffer.from(original));
    const result = await shell.exec("ssh-keygen -R oldhost.local -f known_hosts");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "# Host oldhost.local found: line 1\nknown_hosts updated.\nOriginal contents retained as known_hosts.old\n");
    assert.equal(Buffer.from(await fs.readFile("/known_hosts")).toString(), "other.local ssh-ed25519 AAAAC3\n");
    assert.equal(Buffer.from(await fs.readFile("/known_hosts.old")).toString(), original);
    if (runtime === "Rust") assert.equal(shell._companion, null);
  } finally {await shell.dispose();}
});
