import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext, FileSystem } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { sedCommand } from "../../src/commands/text-programs/sed.js";
import { toByteSource } from "../../src/contracts/index.js";
import { editInPlace, prepareInPlace } from "../../src/commands/text-programs/inplace.js";
import { Budget } from "../../src/commands/text-programs/shared.js";
import { fixture } from "./helpers.js";

for (const suffix of ["", ".bak"]) {
  for (const phase of ["read", "publication", "backup"]) {
    if (phase === "backup" && !suffix) continue;
    test(`sed -i${suffix} refuses parent swap at ${phase}`, async t => {
      const relative = phase === "publication" ? "sub/file" : "file";
      const path = "/work/visible/" + relative;
      const backing = await fixture({ ["visible/" + relative]: "old\n", ["/private/" + relative]: "secret\n", ["/private/" + relative + ".bak"]: "backup\n" });
      let swapped = false;
      const wrap = (view: FileSystem): FileSystem => new Proxy(view, {
        get(target, property) {
          if (property === "confineExtraction") return async (...args: Parameters<NonNullable<FileSystem["confineExtraction"]>>) => wrap(await backing.confineExtraction(...args));
          const member: unknown = Reflect.get(target, property, target);
          if (typeof member !== "function") return member;
          if (property === "readStream") return (...args: Parameters<NonNullable<FileSystem["readStream"]>>) => (async function* () {
            if (!swapped && phase === "read") {
              swapped = true;
              await backing.rename("/work/visible", "/work/held");
              await backing.symlink("/private", "/work/visible");
            }
            yield* target.readStream!(...args);
          })();
          return async (...args: unknown[]) => {
            const operand = args[0];
            const trigger = phase === "read" ? ["openReadFile", "readStream", "readFile"].includes(String(property))
              : phase === "backup" ? ["copyFile", "writeFileConditional"].includes(String(property)) && (property === "copyFile" || operand === path + ".bak")
              : ["writeFile", "writeFileConditional"].includes(String(property)) && operand === path;
            if (!swapped && trigger) {
              swapped = true;
              await backing.rename("/work/visible", "/work/held");
              await backing.symlink("/private", "/work/visible");
            }
            return Reflect.apply(member, target, args);
          };
        },
      });
      const shell = new Shell({ fs: wrap(backing), cwd: "/work" }).use(agentCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec(`sed -i${suffix} 's/old/new/' visible/${relative}`);
      assert.equal(swapped, true, "race must reach the intended boundary");
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(new TextDecoder().decode(await backing.readFile("/private/" + relative)), "secret\n");
      assert.equal(new TextDecoder().decode(await backing.readFile("/private/" + relative + ".bak")), "backup\n");
      assert.equal(new TextDecoder().decode(await backing.readFile("/work/held/" + relative)), "old\n");
    });
  }
}

for (const missing of ["writeFileConditional", "confineExtraction", "openReadFile"]) {
  test(`sed refuses in-place edits without ${missing} before any output`, async t => {
    const backing = await fixture({ file: "old\n", output: "keep" });
    const fs = new Proxy(backing, { get(target, property) {
      if (property === missing) return undefined;
      const member: unknown = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec("sed -i 's/old/new/;w output' file");
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "old\n");
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "keep");
  });
}

test("sed refuses a backup symlink without changing its referent or the input", async t => {
  const backing = await fixture({ file: "old\n", secret: "keep\n" });
  await backing.symlink("/work/secret", "/work/file.bak");
  const shell = new Shell({ fs: backing, cwd: "/work" }).use(agentCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("sed -i.bak 's/old/new/' file");
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/secret")), "keep\n");
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "old\n");
});

test("sed closes its retained reader if cleanup registration rejects", async () => {
  const backing = await fixture({ file: "old\n" });
  let closed = false;
  const fs = new Proxy(backing, { get(target, property) {
    if (property === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      const reader = await target.openReadFile(...args);
      return { ...reader, async close() { closed = true; await reader.close(); } };
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await sedCommand().execute({
    command: "sed", args: ["-i", "s/old/new/", "file"], cwd: "/work", env: {}, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
    registerCleanup() { throw new Error("invocation is closed"); },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(closed, true);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "old\n");
});

for (const phase of ["read", "publication"]) {
  test(`sed refuses a replaced target at ${phase}`, async t => {
    const backing = await fixture({ file: "old\n", replacement: "keep\n" });
    let swapped = false;
    const wrap = (view: FileSystem): FileSystem => new Proxy(view, { get(target, property) {
      if (property === "confineExtraction") return async (...args: Parameters<NonNullable<FileSystem["confineExtraction"]>>) => wrap(await backing.confineExtraction(...args));
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== "function") return member;
      return async (...args: unknown[]) => {
        if (!swapped && (phase === "read" ? property === "openReadFile" : property === "writeFileConditional")) {
          swapped = true;
          await backing.rename("/work/file", "/work/held");
          await backing.rename("/work/replacement", "/work/file");
        }
        return Reflect.apply(member, target, args);
      };
    } });
    const shell = new Shell({ fs: wrap(backing), cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec("sed -i 's/old/new/' file");
    assert.equal(swapped, true);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "keep\n");
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/held")), "old\n");
  });
}

test("sed in-place retains original backup bytes even after early quit", async t => {
  const backing = await fixture({ file: "first\nsecond\n", "file.bak": "previous" });
  const shell = new Shell({ fs: backing, cwd: "/work" }).use(agentCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("sed -i.bak 's/first/new/;q' file");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "new\n");
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/file.bak")), "first\nsecond\n");
});

for (const mode of [0o600, 0o644, 0o751]) {
  for (const existing of [false, true]) {
    test(`sed in-place preserves mode ${mode.toString(8)} in ${existing ? "replaced" : "new"} backups`, async t => {
      const backing = await fixture({ file: "first\nsecond\n" });
      await backing.chmod("/work/file", mode);
      if (existing) await backing.writeFile("/work/file.bak", new TextEncoder().encode("previous"), { mode: 0o660 });
      const shell = new Shell({ fs: backing, cwd: "/work" }).use(agentCommands());
      t.after(() => shell.dispose());
      const result = await shell.exec("sed -i.bak 's/first/new/;q' file");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "new\n");
      assert.equal(new TextDecoder().decode(await backing.readFile("/work/file.bak")), "first\nsecond\n");
      assert.equal((await backing.stat("/work/file")).mode & 0o7777, mode);
      assert.equal((await backing.stat("/work/file.bak")).mode & 0o7777, mode);
    });
  }
}

for (const replacement of ["parent", "backup"] as const) {
  test(`sed staged backup refuses a replaced ${replacement}`, async t => {
    const backing = await fixture({ "visible/file": "old\n", "visible/file.bak": "previous\n", "replacement/file": "private\n", "replacement/file.bak": "private backup\n" });
    await backing.chmod("/work/visible/file", 0o640);
    let swapped = false;
    const fs = new Proxy(backing, { get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (property === "publishStagedFile") return async (...args: Parameters<NonNullable<FileSystem["publishStagedFile"]>>) => {
        swapped = true;
        if (replacement === "parent") {
          await backing.rename("/work/visible", "/work/held");
          await backing.rename("/work/replacement", "/work/visible");
        } else await backing.rename("/work/replacement/file.bak", "/work/visible/file.bak");
        return target.publishStagedFile(...args);
      };
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const execution = shell.exec("sed -i.bak 's/old/new/' visible/file");
    if (replacement === "parent") await assert.rejects(execution, { code: "EAGAIN" });
    else assert.equal((await execution).exitCode, 1);
    assert.equal(swapped, true);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/visible/file.bak")), "private backup\n");
    const original = replacement === "parent" ? "/work/held/file" : "/work/visible/file";
    assert.equal(new TextDecoder().decode(await backing.readFile(original)), "old\n");
  });
}

for (const primary of [false, 0, "", null, new Error("publication failed")]) {
  for (const cleanupFails of [false, true]) {
    test(`sed staged backup retains publication failure ${String(primary)} with cleanup failure ${cleanupFails}`, async () => {
      const backing = await fixture({ file: "old\n", "file.bak": "previous\n" });
      await backing.chmod("/work/file", 0o640);
      const cleanupFailure = new Error("cleanup failed");
      const fs = new Proxy(backing, { get(target, property) {
        if (property === "publishStagedFile") return async () => { throw primary; };
        if (property === "removeStagedFile" && cleanupFails) return async () => { throw cleanupFailure; };
        const member: unknown = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
      const context: CommandContext = {
        command: "sed", args: [], cwd: "/work", env: {}, fs, stdin: toByteSource(""),
        signal: new AbortController().signal, stdout: { async write() {} }, stderr: { async write() {} },
      };
      const [target] = await prepareInPlace(context, ["file"], ".bak");
      await assert.rejects(editInPlace(context, target!, ".bak", new Budget(context, {}), async () => ({
        data: new TextEncoder().encode("new\n"), result: 0,
      })), error => {
        if (!cleanupFails) return Object.is(error, primary);
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [primary, cleanupFailure]);
        return true;
      });
      assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "old\n");
      assert.equal(new TextDecoder().decode(await backing.readFile("/work/file.bak")), "previous\n");
    });
  }
}

for (const reason of [false, 0, "", null]) {
  test(`sed staged backup cleans admitted staging after cancellation ${JSON.stringify(reason)}`, async t => {
    const backing = await fixture({ file: "old\n", "file.bak": "previous\n" });
    await backing.chmod("/work/file", 0o640);
    const caller = new AbortController();
    let staged = false;
    const fs = new Proxy(backing, { get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (property === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
        const receipt = await target.createStagedFile(...args);
        staged = true;
        caller.abort(reason);
        return receipt;
      };
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    await assert.rejects(shell.exec("sed -i.bak 's/old/new/' file", { signal: caller.signal }), error => Object.is(error, reason));
    assert.equal(staged, true);
    assert.deepEqual((await backing.readdir("/work")).map(entry => entry.name).sort(), ["file", "file.bak"]);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "old\n");
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/file.bak")), "previous\n");
  });
}

for (const operand of ["file/", "file/."]) {
  test(`sed in-place preserves directory traversal checks for ${operand}`, async t => {
    const backing = await fixture({ file: "old\n" });
    const shell = new Shell({ fs: backing, cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`sed -i 's/old/new/' ${operand}`);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "old\n");
  });
}
