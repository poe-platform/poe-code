import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { sedCommand } from "../../src/commands/text-programs/sed.js";
import { toByteSource } from "../../src/contracts/index.js";
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
