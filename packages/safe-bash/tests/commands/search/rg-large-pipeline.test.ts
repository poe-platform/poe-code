import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, Shell, agentCommands } from "../../../src/index.js";
import { searchCommands } from "../../../src/commands/search/index.js";

test("large file enumeration settles through sparse filters and early consumers", { timeout: 10_000 }, async () => {
  const fs = new MemoryFileSystem();
  const expected: string[] = [];
  for (let directory = 0; directory < 150; directory++) {
    const path = `/out/tree-${String(directory).padStart(3, "0")}`;
    await fs.mkdir(path, { recursive: true });
    for (let file = 0; file < 1000; file++) {
      const name = `${path}/${String(file).padStart(4, "0")}${file === 999 && directory % 20 === 0 ? "-needle" : ""}`;
      await fs.writeFile(name, new Uint8Array());
      if (name.endsWith("-needle")) expected.push(name.slice(1));
    }
  }
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const [command, output] of [
      ['rg --files out | rg needle | head -n 12', expected.join("\n") + "\n"],
      ['rg --files out | rg needle | head -n 1', expected[0] + "\n"],
      ['rg --files out | rg absent | head -n 12', ""],
      ['seq 20000 | rg ^9999$ | head -n 12', "9999\n"],
    ] as const) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, output);
    }
  } finally {
    await shell.dispose();
  }
  const bounded = new Shell({ fs }).use(agentCommands()).use(searchCommands({ maxFiles: 1000, replace: true }));
  try {
    const result = await bounded.exec('set -o pipefail; rg --files out | rg needle | head -n 12');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /filesystem entry limit exceeded/u);
  } finally {
    await bounded.dispose();
  }
  // Disable memory shortcuts to exercise the traversal used by disk/remote adapters.
  const generic = new Proxy(fs, {
    get(target, key) {
      if (key === "capabilitiesFor") return async () => target.capabilities;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const genericShell = new Shell({ fs: generic }).use(agentCommands());
  try {
    const result = await genericShell.exec('rg --files out | rg needle | head -n 12');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected.join("\n") + "\n");
  } finally {
    await genericShell.dispose();
  }
});

test("sparse recursive content search prunes generated trees and skips self symlinks", { timeout: 5_000 }, async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/repo/.git", { recursive: true });
  await memory.writeFile("/repo/.gitignore", new TextEncoder().encode("target/\n"));
  const expected: string[] = [];
  for (let index = 0; index < 8; index++) {
    const path = `/repo/packages/p${index}`;
    await memory.mkdir(`${path}/target`, { recursive: true });
    await memory.writeFile(`${path}/Cargo.lock`, new TextEncoder().encode('name = "toolcraft-design-rust"\n'));
    await memory.symlink(path, `${path}/self`);
    for (let file = 0; file < 1000; file++) {
      await memory.writeFile(`${path}/target/${file}.rs`, new Uint8Array());
    }
    expected.push(`packages/p${index}/Cargo.lock`);
  }
  const listings: string[] = [];
  const fs = new Proxy(memory, {
    get(target, key) {
      if (key === "capabilitiesFor") return async () => target.capabilities;
      if (key === "readdir") return async (...args: Parameters<typeof memory.readdir>) => {
        listings.push(args[0]);
        return target.readdir(...args);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shell = new Shell({ fs, cwd: "/repo" }).use(agentCommands());
  try {
    const result = await shell.exec(`rg -l 'name = "toolcraft-design-rust"' packages -g Cargo.lock`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected.join("\n") + "\n");
    assert.deepEqual(listings, ["/repo/packages", ...expected.map(path => `/repo/${path.slice(0, -"/Cargo.lock".length)}`)]);
  } finally {
    await shell.dispose();
  }
});
