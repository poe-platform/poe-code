import assert from "node:assert/strict";
import { dirname } from "node:path";
import { CommandRegistry, FsError, pipeBytes, toByteSource, writeText } from "../../../src/contracts/index.js";
import type { ByteSource, FileSystem } from "../../../src/contracts/index.js";
import { createStandardCommands } from "../../../src/commands/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { cases } from "./cases.js";
import { fixtureBytes, quote } from "./support.js";

async function setup(locale = "C") {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const commands = new CommandRegistry(createStandardCommands());
  const shell = new Shell({ fs, commands, cwd: "/work", env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: locale, LANG: locale, TZ: "UTC" } });
  return { fs, commands, shell };
}

async function differential(id: string) {
  const row = cases.find(candidate => candidate.id === id);
  assert.ok(row);
  const { fs, shell } = await setup(row.locale);
  for (const fixture of row.fixtures ?? []) {
    const path = `/work/${fixture.path}`;
    await fs.mkdir(dirname(path), { recursive: true });
    if (fixture.directory) await fs.mkdir(path, { recursive: true });
    else if (fixture.link) await fs.symlink(fixture.link, path);
    else await fs.writeFile(path, fixtureBytes(fixture, "/bin/bash"), { mode: fixture.mode ?? 0o644 });
  }
  for (const fixture of row.fixtures ?? []) if (fixture.directory && fixture.mode !== undefined) await fs.chmod(`/work/${fixture.path}`, fixture.mode);
  const source = row.source.replaceAll("{{bash}}", "bash").replaceAll("{{sh}}", "sh");
  const role = row.role ?? "bash";
  let args = ["-c", source, role];
  let bytes = row.stdinHex === undefined ? Buffer.from(row.stdin ?? "") : Buffer.from(row.stdinHex, "hex");
  if (row.entry === "stdin") { args = ["-s"]; bytes = Buffer.from(source); }
  else if (row.entry === "file") { args = ["entry.sh"]; await fs.writeFile("/work/entry.sh", Buffer.from(source)); }
  const stdin: ByteSource = (async function* () {
    for (let offset = 0; offset < bytes.length; offset += row.chunkBytes ?? bytes.length) yield bytes.subarray(offset, offset + (row.chunkBytes ?? bytes.length));
  })();
  const result = await shell.exec([role, ...args].map(quote).join(" "), { stdin });
  return { id, source, role, args, inputHex: bytes.toString("hex"), exitCode: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), stdout: result.stdout, stderr: result.stderr };
}

async function host(id: string) {
  const { fs, commands, shell } = await setup("en_US.UTF-8");
  if (id === "host-registry-interpreter-discovery") {
    commands.register({ name: "cloreg", async execute(context) { await writeText(context.stdout, `registry:${JSON.stringify(context.args)}\n`); return { exitCode: 0 }; } });
    const result = await shell.exec('command -v cloreg bash sh; cloreg() { printf "function\\n"; }; type -t cloreg; command cloreg "*;literal" ""');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, 'cloreg\nbash\nsh\nfunction\nregistry:["*;literal",""]\n');
  } else if (id === "host-command-invoke-middleware-origin") {
    await fs.mkdir("/work/sub");
    const seen: string[] = [];
    shell.use(async (context, next) => { seen.push(context.command); return next(); });
    commands.register({ name: "cloreg", async execute(context) {
      assert.equal(context.cwd, "/work/sub"); assert.equal(context.env.VALUE, "temporary");
      assert.equal(context.stdinIsDefault, false); assert.deepEqual(context.args, ["*;literal", ""]);
      await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 };
    } });
    commands.register({ name: "relay", async execute(context) {
      assert.ok(context.invoke);
      return context.invoke("command", ["cloreg", "*;literal", ""], { cwd: "/work/sub", env: { ...context.env, VALUE: "temporary" }, stdin: toByteSource("payload\n") });
    } });
    const result = await shell.exec("relay");
    assert.equal(result.stdout, "payload\n"); assert.equal(result.stderr, "");
    assert.deepEqual(seen, ["relay", "command", "cloreg"]);
  } else if (id === "host-command-shared-budget") {
    commands.register({ name: "repeat", async execute(context) {
      assert.ok(context.invoke);
      for (let index = 0; index < 20; index++) await context.invoke("command", ["true"]);
      return { exitCode: 0 };
    } });
    await assert.rejects(shell.exec("repeat", { limits: { maxCommands: 6 } }), error => error instanceof ShellLimitError && error.limit === "maxCommands");
    await assert.rejects(shell.exec('command bash -c \'printf 123456\'', { limits: { maxOutputBytes: 5 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } else if (id === "host-discovery-permission-cache-host-leak") {
    await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\nprintf 'ran\\n'\n"), { mode: 0o755 });
    commands.register({ name: "revoke", async execute() { await fs.chmod("/work/tool", 0o644); return { exitCode: 0 }; } });
    commands.register({ name: "remove", async execute() { await fs.rm("/work/tool"); return { exitCode: 0 }; } });
    const result = await shell.exec('PATH=""; command -v tool; command tool; revoke; command tool; printf "denied:%s\\n" "$?"; remove; command -v tool; printf "missing:%s\\n" "$?"; PATH=/bin:/usr/bin; command -v /bin/ls; printf "host:%s\\n" "$?"');
    assert.equal(result.stdout, "./tool\nran\ndenied:126\nmissing:1\nhost:1\n");
    assert.match(result.stderr, /tool.*[Pp]ermission denied/u);
  } else if (id === "host-read-N-cancel-partial-character") {
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { path: "partial-character-caller" });
    let secondRead = false;
    const stdin: ByteSource = (async function* () {
      yield Uint8Array.of(0xc3);
      secondRead = true;
      setTimeout(() => controller.abort(reason), 5);
      await new Promise((_accept, reject) => setTimeout(() => reject(new Error("late partial character rejection")), 35));
    })();
    await assert.rejects(shell.exec('bash -c \'read -r -N 1 value; printf never\'', { stdin, signal: controller.signal }), error => error === reason);
    assert.equal(secondRead, true);
    await new Promise(accept => setTimeout(accept, 60));
  } else if (id === "host-query-cancel-late-rejection") {
    const controller = new AbortController();
    const reason = new FsError("EACCES", { path: "query-caller" });
    let entered = false;
    const delayed = new Proxy(fs, { get(target, property) {
      if (property === "stat") return (_path: string, options: { signal?: AbortSignal }) => {
        assert.ok(options.signal); entered = true;
        setTimeout(() => controller.abort(reason), 5);
        return new Promise((_accept, reject) => setTimeout(() => reject(new Error("late lookup")), 35));
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    await assert.rejects(shell.exec("PATH=tools command -v closuretool", { fs: delayed, signal: controller.signal }), error => error === reason);
    assert.equal(entered, true); await new Promise(accept => setTimeout(accept, 60));
  } else if (id === "host-sh-profile-never-global") {
    const child = await shell.exec('value=parent; sh -c \'value=before; value=child :; printf "%s\\n" "$value"\'; printf "%s\\n" "$value"');
    assert.equal(child.stdout, "child\nparent\n");
    const later = await shell.exec('value=before; value=after :; printf "%s\\n" "$value"');
    assert.equal(later.stdout, "before\n");
  } else if (id === "host-unknown-permission-discovery") {
    await fs.writeFile("/work/tool", Buffer.from("#!/bin/bash\ntrue\n"), { mode: 0o755 });
    const unknown = new Proxy(fs, { get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, permissions: false };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    for (const source of ['PATH="" command -v tool', 'PATH="" type -p tool']) {
      const result = await shell.exec(source, { fs: unknown });
      assert.notEqual(result.exitCode, 0); assert.equal(result.stdout, "");
    }
  } else throw new Error(`Unknown host row ${id}`);
  return { id, passed: true };
}

try {
  const id = process.argv[2]!;
  console.log(JSON.stringify(id.startsWith("host-") ? await host(id) : await differential(id)));
} catch (error) {
  console.log(JSON.stringify({ id: process.argv[2], error: String(error), stack: error instanceof Error ? error.stack : undefined }));
  process.exitCode = 1;
}
