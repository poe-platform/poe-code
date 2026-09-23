import assert from "node:assert/strict";
import test from "node:test";
import { chunks, fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

// Response and status expectations verified against GNU coreutils 9.10, locale C.
for (const option of ["-i", "--interactive"]) {
  for (const answer of ["y\n", "Y\n", "yes\n", "yesterday\n", "y", "n\n", "", "\ny\n", " y\n", "\tY\n"]) {
    test(`cp ${option} respects answer ${JSON.stringify(answer)}`, async () => {
      const fs = await fixture({ source: "SOURCE\n", dest: "DEST\n" });
      const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(`cp ${option} source dest`, { stdin: answer });
      const accepted = answer[0] === "y" || answer[0] === "Y";
      assert.equal(result.exitCode, accepted ? 0 : 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "cp: overwrite 'dest'? ");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "SOURCE\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), accepted ? "SOURCE\n" : "DEST\n");
    });
  }
}

for (const option of ["-ni", "-ini", "-if", "-fi", "--no-clobber --interactive", "--interactive --force", "--force --interactive"]) {
  test(`cp ${option} prompts before overwriting`, async () => {
    const fs = await fixture({ source: "new", dest: "old" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`cp ${option} source dest`, { stdin: "y\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "cp: overwrite 'dest'? ");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "new");
  });
}

for (const args of [["-in"], ["-nin"], ["--interactive", "--no-clobber"], ["-i", "--no-clobber", "--force"]]) {
  test(`cp ${args.join(" ")} preserves an existing destination without reading stdin`, async () => {
    const fs = await fixture({ source: "new", dest: "old" });
    const stdin = { [Symbol.asyncIterator](): never { throw new Error("unexpected stdin read"); } };
    const result = await run("cp", [...args, "source", "dest"], { fs, stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "old");
  });
}

test("cp interactive option ordering ignores suffix values and operands after --", async () => {
  for (const [command, backup] of [
    ["cp -nibSni source dest", "destni"],
    ["cp -nib --suffix -n source dest", "dest-n"],
    ["cp -i -- source -in", undefined],
  ] as const) {
    const fs = await fixture({ source: "new", dest: "old", "-in": "old" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(command, { stdin: "y\n" });
    const target = backup ? "dest" : "-in";
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, `cp: overwrite '${target}'? `);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${target}`)), "new");
    if (backup) assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${backup}`)), "old");
  }
});

test("cp interactive reads one response per existing target across multiple sources", async () => {
  const fs = await fixture({ a: "new-a", b: "new-b", c: "new-c", "dest/a": "old-a", "dest/c": "old-c" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("cp -iv a b c ./dest/", { stdin: chunks("no\nyes\n") });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stderr, "cp: overwrite './dest/a'? cp: overwrite './dest/c'? ");
  assert.equal(result.stdout, "'b' -> './dest/b'\n'c' -> './dest/c'\n");
  for (const name of ["a", "b", "c"]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/dest/${name}`)), `${name === "a" ? "old" : "new"}-${name}`);
  }
});

test("cp recursive interactive copies continue after refusal and back up only accepted leaves", async () => {
  const fs = await fixture({ "source/a": "new-a", "source/b": "new-b", "source/c": "new-c", "dest/a": "old-a", "dest/b": "old-b" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("cp -RiTb source ./dest", { stdin: "n\ny\n" });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stderr, "cp: overwrite './dest/a'? cp: overwrite './dest/b'? ");
  assert.equal(result.stdout, "");
  for (const name of ["a", "b", "c"]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/dest/${name}`)), `${name === "a" ? "old" : "new"}-${name}`);
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest/b~")), "old-b");
  await assert.rejects(fs.stat("/work/dest/a~"), { code: "ENOENT" });
});

for (const mode of ["-b", "--remove-destination", "--attributes-only --preserve=mode", "-l", "-s", "-P"]) {
  test(`cp -i ${mode} preserves declined destination entries and metadata`, async () => {
    const fs = await fixture({ source: "new", referent: "old" });
    await fs.symlink("referent", "/work/dest");
    if (mode === "-P") await fs.symlink("source", "/work/source-link");
    const before = await fs.lstat("/work/dest");
    const referentBefore = await fs.stat("/work/referent");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`cp -i ${mode} ${mode === "-P" ? "source-link" : "source"} dest`, { stdin: "n\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "cp: overwrite 'dest'? ");
    assert.deepEqual(await fs.lstat("/work/dest"), before);
    assert.deepEqual(await fs.stat("/work/referent"), referentBefore);
    assert.equal(await fs.readlink("/work/dest"), "referent");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/referent")), "old");
    await assert.rejects(fs.stat("/work/dest~"), { code: "ENOENT" });
  });
}

test("cp update and missing destinations do not consume interactive responses", async () => {
  const fs = await fixture({ a: "new-a", b: "new-b", c: "new-c", "dest/a": "old-a", "dest/c": "old-c" });
  for (const name of ["a", "b", "c"]) await fs.utimes(`/work/${name}`, 2000, 2000);
  await fs.utimes("/work/dest/a", 3000, 3000);
  await fs.utimes("/work/dest/c", 1000, 1000);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("cp -iu a b c dest", { stdin: "y\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "cp: overwrite 'dest/c'? ");
  for (const name of ["a", "b", "c"]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/dest/${name}`)), `${name === "a" ? "old" : "new"}-${name}`);
  }
});

test("cp interactive closes the response stream after the final prompt", async () => {
  const fs = await fixture({ source: "new", dest: "old" });
  let closed = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try { yield new TextEncoder().encode("y\nunused\n"); }
    finally { closed = true; }
  } };
  const result = await run("cp", ["-i", "source", "dest"], { fs, stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(closed, true);
});

test("cp cancellation while reading confirmation preserves the destination", async () => {
  const fs = await fixture({ source: "new", dest: "old" });
  const controller = new AbortController();
  const reason = new Error("cancel confirmation");
  let closed = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      controller.abort(reason);
      yield new TextEncoder().encode("y\n");
    } finally { closed = true; }
  } };
  await assert.rejects(run("cp", ["-i", "source", "dest"], { fs, stdin, signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "old");
});

for (const [target, quoted] of [
  ["d'est", `"d'est"`],
  ["d\nest", "'d'$'\\n''est'"],
  ["d\test", "'d'$'\\t''est'"],
  ["\n'", "''$'\\n'\\'''"],
] as const) {
  test(`cp interactive quotes destination ${JSON.stringify(target)} like GNU`, async () => {
    const fs = await fixture({ source: "new", [target]: "old" });
    const result = await run("cp", ["-i", "source", target], { fs, stdin: "n\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, `cp: overwrite ${quoted}? `);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${target}`)), "old");
  });
}
