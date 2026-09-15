import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../shell/index.js";
import { createMemoryFileSystem } from "../../fs/memory/index.js";
import { standardCommands } from "../index.js";
import { createObjectBackend, opCommands } from "./index.js";

const encode = (value: string) => new TextEncoder().encode(value);
const seed = () => createObjectBackend({ vaults: [{ id: "vault", name: "Team" }], items: [{ id: "item", title: "Login", vault: { id: "vault" }, fields: [{ id: "password", type: "CONCEALED", value: "secret" }] }] });

test("op is explicit, shares pipelines, and preserves environment expansion", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { REF: "op://Team/Login/password" } });
  shell.use(standardCommands());
  assert.notEqual((await shell.exec('op read "$REF"')).exitCode, 0);
  shell.use(opCommands({ backend: seed(), authorize: () => "allow" }));
  const result = await shell.exec('op read "$REF" | cat');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "secret\n");
});

test("document input and secret output use cwd-relative virtual files and owned bytes", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const bytes = Uint8Array.of(0, 255, 128, 10);
  await fs.writeFile("/work/input.bin", bytes);
  const shell = new Shell({ fs, cwd: "/work" });
  shell.use(opCommands({ backend: createObjectBackend({ vaults: [{ id: "team", name: "Team" }, { id: "private", name: "Private" }], defaultVault: "team" }), authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => true }));
  const created = await shell.exec("op document create input.bin --title Blob --format json");
  assert.equal(created.exitCode, 0, created.stderr);
  const id = (JSON.parse(created.stdout) as { id: string }).id;
  assert.equal(JSON.parse(created.stdout).vault.id, "team");
  const output = await shell.exec(`op document get ${id} --out-file result.bin`);
  assert.equal(output.exitCode, 0, output.stderr);
  assert.deepEqual(await fs.readFile("/work/result.bin"), bytes);
  assert.equal((await fs.stat("/work/result.bin")).mode & 0o777, 0o600);
  assert.notEqual((await shell.exec(`op document get ${id} --out-file result.bin`)).exitCode, 0);
  assert.equal((await shell.exec(`op document get ${id} --out-file result.bin --force`)).exitCode, 0);
});

test("denied input never reads VFS or stdin and resolved approval binds IDs", async () => {
  const fs = createMemoryFileSystem();
  fs.readFile = async () => { assert.fail("denied command read VFS"); };
  const denied = new Shell({ fs });
  denied.use(opCommands({ backend: seed(), authorize: () => "deny" }));
  assert.equal((await denied.exec("op document create denied.bin")).exitCode, 1);
  let pulls = 0;
  const input = { async *[Symbol.asyncIterator]() { pulls++; yield encode("private input"); } };
  assert.equal((await denied.exec("op document create - --vault Team", { stdin: input })).exitCode, 1);
  assert.equal(pulls, 0);
  const stages: string[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(opCommands({ backend: seed(), authorize: () => "ask", authorizeResolution() { stages.push("resolve"); return true; }, approveResolved(manifest) {
    stages.push("approve");
    assert.ok(manifest.targets.some(target => target.id === "item"));
    assert.equal(JSON.stringify(manifest).includes("secret"), false);
    return true;
  } }));
  const result = await shell.exec("op read op://Team/Login/password");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(stages, ["resolve", "approve"]);
});

test("op run invokes registered virtual commands with isolated resolved environment", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { TOKEN: "op://Team/Login/password", KEEP: "yes" } });
  shell.register({ name: "capture", async execute(context) {
    assert.equal(context.env.TOKEN, "secret");
    assert.equal(context.env.KEEP, "yes");
    await context.stdout.write(encode(context.args.join("|")));
    return { exitCode: 7 };
  } });
  shell.use(opCommands({ backend: seed(), authorize: () => "allow" }));
  const result = await shell.exec("op run -- capture 'a b' c");
  assert.equal(result.exitCode, 7, result.stderr);
  assert.equal(result.stdout, "a b|c");
  assert.notEqual((await shell.exec("op run -- definitely-not-a-host-command")).exitCode, 0);
});

test("cancellation reaches backend without successful output", async () => {
  const controller = new AbortController();
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(opCommands({ backend: { async execute(_request, context) {
    controller.abort(new Error("cancelled"));
    assert.equal(context.signal.aborted, true);
    context.signal.throwIfAborted();
  } }, authorize: () => "allow" }));
  let output = "";
  await assert.rejects(shell.exec("op vault list", { signal: controller.signal, stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } } }), { message: "cancelled" });
  assert.equal(output, "");
});

test("file writes fail closed on insufficient VFS capabilities and symlinks", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/target", encode("untouched"));
  await fs.symlink("/target", "/link");
  const shell = new Shell({ fs });
  shell.use(opCommands({ backend: seed(), authorize: () => "allow" }));
  assert.equal((await shell.exec("op read op://Team/Login/password --out-file /link --force")).exitCode, 1);
  assert.equal(new TextDecoder().decode(await fs.readFile("/target")), "untouched");
  Object.assign(fs, { capabilitiesFor: async () => ({ ...fs.capabilities, permissions: false }) });
  assert.equal((await shell.exec("op read op://Team/Login/password --out-file /new")).exitCode, 1);
  await assert.rejects(fs.stat("/new"));
});

test("trusted chooser is forwarded only after both permission gates", async () => {
  const stages: string[] = [];
  const backend = createObjectBackend({ resources: { plugin: [{ id: "custom", name: "Custom" }] } });
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.use(opCommands({ backend, authorize() { stages.push("authorize"); return "ask"; },
    authorizeResolution() { stages.push("resolution"); return true; },
    selectPlugin(candidates) { stages.push("select"); assert.ok(candidates.some(candidate => candidate.id === "custom")); return "custom"; },
    approveResolved(manifest) { stages.push("approve"); assert.ok(manifest.targets.some(target => target.id === "custom")); return true; },
  }));
  const result = await shell.exec("op plugin inspect --format json");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(stages, ["authorize", "resolution", "select", "approve"]);
});

test("resolved approval rejection and target replacement produce no secret output", async () => {
  for (const mutate of [false, true]) {
    const backend = seed();
    const shell = new Shell({ fs: createMemoryFileSystem() });
    shell.use(opCommands({ backend, authorize: () => "ask", authorizeResolution: () => true,
      async approveResolved() {
        if (mutate) await backend.execute({ resource: "item", action: "edit", args: ["item"], flags: { title: "Renamed" } }, { signal: new AbortController().signal });
        return mutate;
      },
    }));
    const result = await shell.exec("op read op://Team/Login/password");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  }
});

test("registration requires explicit replacement", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  shell.register({ name: "op", execute: () => ({ exitCode: 19 }) });
  shell.use(opCommands({ backend: seed(), authorize: () => "allow", replace: true }));
  assert.equal((await shell.exec("op read op://Team/Login/password")).exitCode, 0);
  const duplicate = new Shell({ fs: createMemoryFileSystem() });
  duplicate.use(opCommands({ backend: seed() }));
  duplicate.use(opCommands({ backend: seed() }));
  await assert.rejects(duplicate.exec("op --help"), { message: "Command already registered: op" });
});

test("nested virtual invocations inherit cwd, stdin bytes and stderr without changing shell environment", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work", env: { TOKEN: "op://Team/Login/password" } });
  const bytes = Uint8Array.of(255, 0, 10);
  shell.register({ name: "consume", async execute(context) {
    assert.equal(context.cwd, "/work");
    assert.equal(context.env.TOKEN, "secret");
    for await (const chunk of context.stdin as AsyncIterable<Uint8Array>) await context.stdout.write(chunk);
    await context.stderr.write(encode("diagnostic"));
    return { exitCode: 0 };
  } });
  shell.register({ name: "checkenv", execute(context) {
    assert.equal(context.env.TOKEN, "op://Team/Login/password");
    return { exitCode: 0 };
  } });
  shell.use(opCommands({ backend: seed(), authorize: () => "allow" }));
  const result = await shell.exec("op run -- consume", { stdin: bytes });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, bytes);
  assert.equal(result.stderr, "diagnostic");
  assert.equal((await shell.exec("checkenv")).exitCode, 0);
});
