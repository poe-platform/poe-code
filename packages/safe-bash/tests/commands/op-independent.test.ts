import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { createObjectBackend, opCommands } from "../../src/commands/op/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const encode = (value: string) => new TextEncoder().encode(value);

function backendFixture() {
  return createObjectBackend({
    defaultVault: "team",
    vaults: [{ id: "team", name: "Team" }],
    items: [{ id: "login", title: "Login", vault: { id: "team" }, category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "synthetic-token" }] }],
  });
}

test("independent op pipeline injects stdin into cwd-relative VFS output", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/template", encode("TOKEN={{ op://Team/Login/password }}\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands());
  assert.notEqual((await shell.exec("op --version")).exitCode, 0);
  shell.use(opCommands({ backend: backendFixture(), authorize: () => "allow" }));
  const result = await shell.exec("cat template | op inject --out-file rendered && cat rendered");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "TOKEN=synthetic-token\n");
  assert.deepEqual(await fs.readFile("/work/rendered"), encode(result.stdout));
  assert.equal((await fs.stat("/work/rendered")).mode & 0o777, 0o600);
});

test("independent op child dispatch masks both streams and preserves parent environment", async () => {
  const reference = "op://Team/Login/password";
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { TOKEN: reference, KEEP: "parent" } }).use(standardCommands());
  let children = 0;
  shell.register({ name: "inspect-child", async execute(context) {
    children++;
    assert.equal(context.env.TOKEN, "synthetic-token");
    assert.equal(context.env.KEEP, "parent");
    assert.deepEqual(context.args, ["literal space", "$(not-executed)"]);
    await context.stdout.write(encode("stdout=" + context.env.TOKEN));
    await context.stderr.write(encode("stderr=" + context.env.TOKEN));
    return { exitCode: 9 };
  } });
  shell.use(opCommands({ backend: backendFixture(), authorize: () => "allow" }));
  const child = await shell.exec("op run -- inspect-child 'literal space' '$(not-executed)'");
  assert.equal(children, 1);
  assert.equal(child.exitCode, 9);
  assert.equal(child.stdout, "stdout=<concealed by 1Password>");
  assert.equal(child.stderr, "stderr=<concealed by 1Password>");
  const parent = await shell.exec('printf "%s|%s" "$TOKEN" "$KEEP"');
  assert.equal(parent.exitCode, 0, parent.stderr);
  assert.equal(parent.stdout, reference + "|parent");
  const unavailable = await shell.exec("op run -- /bin/sh -c 'printf HOST_ESCAPE'");
  assert.notEqual(unavailable.exitCode, 0);
  assert.equal(unavailable.stdout, "");
  assert.equal(children, 1);
});

test("independent op denial precedes VFS acquisition and child invocation", async () => {
  const fs = createMemoryFileSystem();
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = async (...args) => { reads++; return readFile(...args); };
  const backend = backendFixture();
  const shell = new Shell({ fs });
  let decisions = 0;
  let children = 0;
  shell.register({ name: "effect", async execute() { children++; return { exitCode: 0 }; } });
  shell.use(opCommands({ backend, authorize: () => { decisions++; return "deny"; } }));
  const before = backend.snapshot();
  for (const source of ["op document create /missing.bin", "op run -- effect", "op item delete Login"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("permission denied"), result.stderr);
  }
  assert.equal(decisions, 3);
  assert.equal(reads, 0);
  assert.equal(children, 0);
  assert.deepEqual(backend.snapshot(), before);
});

test("independent resolved approval rejects a stale target without invoking its child", async () => {
  const backend = backendFixture();
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { TOKEN: "op://Team/Login/password" } });
  let children = 0;
  let resolutions = 0;
  let approvals = 0;
  shell.register({ name: "effect", async execute() { children++; return { exitCode: 0 }; } });
  shell.use(opCommands({
    backend,
    authorize: () => "ask",
    authorizeResolution: () => { resolutions++; return true; },
    async approveResolved(manifest, context) {
      approvals++;
      assert.ok(manifest.targets.some(target => target.id === "login"));
      assert.equal(JSON.stringify(manifest).includes("synthetic-token"), false);
      await backend.execute({ resource: "item", action: "edit", args: ["login", "password=rotated-token"], flags: {} }, { signal: context.signal });
      return true;
    },
  }));
  const result = await shell.exec("op run -- effect");
  assert.equal(resolutions, 1);
  assert.equal(approvals, 1);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(children, 0);
  assert.equal(backend.snapshot().items?.[0]?.fields?.find(field => field.id === "password")?.value, "rotated-token");
});
