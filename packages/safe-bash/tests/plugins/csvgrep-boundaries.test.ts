import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { csvgrep, csvgrepCommands } from "../../src/commands/csvgrep/index.js";
test("csvgrep quota failure preserves a partial redirect and blocks conditional publication", async (t) => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands()).use(csvgrepCommands({ limits: { outputBytes: 2 } }));
  t.after(() => shell.dispose());
  const enc = new TextEncoder();
  await fs.writeFile("/input", enc.encode("x\na\n"));
  await fs.writeFile("/published", enc.encode("previous"));
  const result = await shell.exec("csvgrep -cx -ma /input > /partial && cp /partial /published");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/partial"), enc.encode("x\n"));
  assert.deepEqual(await fs.readFile("/published"), enc.encode("previous"));
});
test("csvgrep same-file redirects through symlink aliases are destructive, not atomic", async (t) => {
  for (const destination of ["/input", "/alias"]) {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(csvgrepCommands());
    t.after(() => shell.dispose());
    await fs.writeFile("/input", new TextEncoder().encode("x\na\n"));
    await fs.symlink("/input", "/alias");
    assert.equal(await fs.realpath("/input"), await fs.realpath(destination));
    const result = await shell.exec(`csvgrep -cx -ma /input > ${destination}`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readFile("/input"), new Uint8Array());
  }
});
test("csvgrep has no host executable or network command fallback", async (t) => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(csvgrepCommands());
  t.after(() => shell.dispose());
  for (const command of ["/usr/bin/csvgrep", "python -m csvkit", "curl https://example.invalid"]) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 127);
    assert.equal(result.stdout, "");
  }
});
test("csvgrep opt-in dispatch uses VFS scripts, pipes, redirects and SDK parity", async (t) => {
  const fs = createMemoryFileSystem(),
    shell = new Shell({ fs }).use(agentCommands()).use(csvgrepCommands());
  t.after(() => shell.dispose());
  const enc = new TextEncoder();
  await fs.writeFile("/input", enc.encode("x,y\na,b\nb,a\n"));
  await fs.writeFile(
    "/run.sh",
    enc.encode("cat /input | csvgrep -c x -m a > /output; cat /output")
  );
  const result = await shell.exec("sh /run.sh");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "x,y\na,b\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/output"), enc.encode(result.stdout));
  shell.use({
    name: "sdk-csvgrep",
    setup(host) {
      host.commands.register({
        name: "sdk-csvgrep",
        execute(context) {
          return csvgrep(context, { columns: "x", match: "a", filePath: "/input" });
        }
      });
    }
  });
  assert.deepEqual(await shell.exec("sdk-csvgrep"), await shell.exec("csvgrep -c x -m a /input"));
  assert.throws(
    () =>
      csvgrepCommands().setup({
        commands: shell.commands,
        use() {
          throw new Error("Unexpected middleware");
        },
        registerFileSystem() {
          throw new Error("Unexpected filesystem");
        }
      }),
    /already registered/
  );
  const denied = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Network forbidden");
  });
  for (const path of ["/etc/passwd", "https://example.invalid/input"]) {
    const missing = await shell.exec(`csvgrep -c x -m a '${path}'`);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "");
  }
  assert.equal(denied.mock.callCount(), 0);
});
