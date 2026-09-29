import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { unameCommands } from "../../src/commands/uname/index.js";
import { nprocCommands } from "../../src/commands/nproc/index.js";
import { hostnameCommands } from "../../src/commands/hostname/index.js";
import { idCommands } from "../../src/commands/id/index.js";
import { whoamiCommands } from "../../src/commands/whoami/index.js";
import { fmtCommands } from "../../src/commands/fmt/index.js";
import { nlCommands } from "../../src/commands/nl/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

function shell() {
  return new Shell({ fs: new MemoryFileSystem() }).use({ name: "basic", setup(host) {
    for (const command of [...basicCommands(), ...streamCommands()]) host.commands.register(command);
  } }).use(unameCommands()).use(nprocCommands()).use(hostnameCommands()).use(idCommands()).use(whoamiCommands()).use(fmtCommands()).use(nlCommands());
}

for (const [prefix, command] of [
  ["", "hostname -f"], ["", "hostname --fqdn"], ["", "hostname --long"],
  ["", "hostname -I"], ["", "hostname --all-ip-addresses"],
  ['export HOSTNAME="";', "hostname"], ['export HOSTNAME=node;', "hostname -f"],
  ['export HOSTNAME=node.example;', "hostname -f"],
  ["export WHOAMI=alice;", "whoami"], ["export GROUP=wheel;", "id"],
  ["export GROUP=wheel;", "id -gn"], ["export SELINUX_CONTEXT=custom;", "id -Z"],
]) {
  test(`system information substitution parity: ${prefix} ${command}`, async () => {
    const instance = shell();
    try {
      const direct = await instance.exec(`${prefix} ${command}`);
      const substituted = await instance.exec(`${prefix} echo "$(${command})"`);
      assert.equal(direct.stderr, "");
      assert.deepEqual(substituted, direct);
    } finally { await instance.dispose(); }
  });
}

for (const [plugin, command, expected] of [
  [unameCommands({ kernelName: "FreeBSD", replace: true }), "uname -s", "FreeBSD\n"],
  [nprocCommands({ processors: 16, replace: true }), "nproc", "16\n"],
  [hostnameCommands({ hostname: "prod-node-1", replace: true }), "hostname", "prod-node-1\n"],
  [idCommands({ uid: 501, replace: true }), "id -u", "501\n"],
  [whoamiCommands({ user: "alice", replace: true }), "whoami", "alice\n"],
] as const) {
  test(`configured command substitution: ${command}`, async () => {
    const instance = shell().use(plugin);
    try {
      assert.equal((await instance.exec(command)).stdout, expected);
      for (const source of [`echo "$(${command})"`, `echo "$(${command} | cat)"`, `echo "$(if true; then ${command}; fi)"`, `for i in 1 2; do echo "$(${command})"; done`]) {
        const result = await instance.exec(source);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, source.startsWith("for ") ? expected.repeat(2) : expected);
      }
    } finally { await instance.dispose(); }
  });
}

for (const command of ["uname", "nproc", "hostname", "id", "whoami"]) {
  test(`custom registered command substitution: ${command}`, async () => {
    const instance = shell().use({ name: "custom", setup(host) {
      host.commands.register({ name: command, async execute(context) {
        await context.stdout.write(new TextEncoder().encode("custom\n"));
        return { exitCode: 0 };
      } }, { replace: true });
    } });
    try { assert.equal((await instance.exec(`echo "$(${command})"`)).stdout, "custom\n"); }
    finally { await instance.dispose(); }
  });
}

for (const command of ['nl /target.txt < /unused.txt', 'nl /target.txt <<< "wrong"', 'printf "wrong\\n" | nl /target.txt']) {
  test(`nl file operand takes precedence over stdin: ${command}`, async () => {
    const instance = shell();
    try {
      await instance.exec('printf "target\\n" > /target.txt; printf "wrong\\n" > /unused.txt');
      const direct = await instance.exec(command);
      assert.equal(direct.stdout, "     1\ttarget\n");
      assert.deepEqual(await instance.exec(`echo "$(${command})"`), direct);
    } finally { await instance.dispose(); }
  });
}

test("fmt substitution preserves stdin and file operands", async () => {
  const instance = shell();
  try {
    await instance.exec('printf "from file\\n" > /file2.txt');
    for (const command of ["fmt - /file2.txt", "fmt - /file2.txt | cat"]) {
      const result = await instance.exec(`printf "from stdin\\n" | { echo "$(${command})"; }`);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "from stdin\nfrom file\n");
    }
  } finally { await instance.dispose(); }
});
