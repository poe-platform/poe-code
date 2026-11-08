import assert from "node:assert/strict";
import test from "node:test";
import { chunks, fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

// Response, status, and option-order expectations verified with GNU 9.10, locale C.
for (const option of ["-i", "--interactive"]) {
  for (const answer of ["y\n", "Y\n", "yes\n", "yesterday\n", "y", "n\n", "", "\ny\n", " y\n", "\tY\n"]) {
    test(`mv ${option} respects answer ${JSON.stringify(answer)}`, async () => {
      const fs = await fixture({ source: "SOURCE\n", dest: "DEST\n" });
      const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
      const result = await shell.exec(`mv ${option} source dest`, { stdin: answer });
      const accepted = answer[0] === "y" || answer[0] === "Y";
      assert.equal(result.exitCode, accepted ? 0 : 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "mv: overwrite 'dest'? ");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), accepted ? "SOURCE\n" : "DEST\n");
      if (accepted) await assert.rejects(fs.lstat("/work/source"), { code: "ENOENT" });
      else assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "SOURCE\n");
    });
  }
}

for (const option of ["-ni", "-fi", "-ifni", "--no-clobber --interactive", "--force --interactive"]) {
  test(`mv ${option} prompts before overwriting`, async () => {
    const fs = await fixture({ source: "new", dest: "old" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`mv ${option} source dest`, { stdin: "y\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "mv: overwrite 'dest'? ");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "new");
    await assert.rejects(fs.lstat("/work/source"), { code: "ENOENT" });
  });
}

for (const [args, moved] of [
  [["-in"], false], [["-fin"], false], [["-fn"], false],
  [["--interactive", "--no-clobber"], false],
  [["-if"], true], [["-nif"], true], [["-nf"], true],
  [["--interactive", "--force"], true],
] as const) {
  test(`mv ${args.join(" ")} does not read stdin`, async () => {
    const fs = await fixture({ source: "new", dest: "old" });
    const stdin = { [Symbol.asyncIterator](): never { throw new Error("unexpected stdin read"); } };
    const result = await run("mv", [...args, "source", "dest"], { fs, stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), moved ? "new" : "old");
    if (moved) await assert.rejects(fs.lstat("/work/source"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "new");
  });
}

test("mv interactive option ordering ignores option values and operands after --", async () => {
  for (const [command, target, backup] of [
    ["mv -nibSfn source dest", "dest", "destfn"],
    ["mv -nib --suffix -f source dest", "dest", "dest-f"],
    ["mv -nit -nf source", "-nf/source", undefined],
    ["mv -i -- source -in", "-in", undefined],
  ] as const) {
    const fs = await fixture({ source: "new", dest: "old", "-in": "old", "-nf/source": "old" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(command, { stdin: "y\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, `mv: overwrite '${target}'? `);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${target}`)), "new");
    if (backup) assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${backup}`)), "old");
  }
});

for (const destination of ["./dest/", "-t ./dest/", "--target-directory=./dest/"]) {
  test(`mv interactive reads one response per existing target: ${destination}`, async () => {
    const fs = await fixture({ a: "new-a", b: "new-b", c: "new-c", "dest/a": "old-a", "dest/c": "old-c" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`mv -iv a b c ${destination}`, { stdin: chunks("no\nyes\n") });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "mv: overwrite './dest/a'? mv: overwrite './dest/c'? ");
    assert.equal(result.stdout, "renamed 'b' -> './dest/b'\nrenamed 'c' -> './dest/c'\n");
    for (const name of ["a", "b", "c"]) {
      assert.equal(new TextDecoder().decode(await fs.readFile(`/work/dest/${name}`)), `${name === "a" ? "old" : "new"}-${name}`);
      if (name !== "a") await assert.rejects(fs.lstat(`/work/${name}`), { code: "ENOENT" });
    }
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/a")), "new-a");
  });
}

for (const answer of ["n\n", "y\n"]) {
  test(`mv interactive creates backups only for accepted replacements: ${JSON.stringify(answer)}`, async () => {
    const fs = await fixture({ source: "new", dest: "old", "dest~": "older" });
    const result = await run("mv", ["-nib", "source", "dest"], { fs, stdin: answer });
    const accepted = answer === "y\n";
    assert.equal(result.exitCode, accepted ? 0 : 1, result.stderr);
    assert.equal(result.stderr, "mv: overwrite 'dest'? ");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), accepted ? "new" : "old");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest~")), accepted ? "old" : "older");
  });

  test(`mv -iT confirms replacing an empty directory: ${JSON.stringify(answer)}`, async () => {
    const fs = await fixture({ "source/child": "new" });
    await fs.mkdir("/work/dest");
    const result = await run("mv", ["-iT", "source", "dest"], { fs, stdin: answer });
    assert.equal(result.exitCode, answer === "y\n" ? 0 : 1, result.stderr);
    assert.equal(result.stderr, "mv: overwrite 'dest'? ");
    assert.deepEqual((await fs.readdir("/work/dest")).map(entry => entry.name), answer === "y\n" ? ["child"] : []);
  });

  for (const dangling of [false, true]) {
    test(`mv interactive confirms replacing the symlink entry (dangling=${dangling}): ${JSON.stringify(answer)}`, async () => {
      const fs = await fixture({ source: "new", ...dangling ? {} : { referent: "keep" } });
      await fs.symlink("referent", "/work/dest");
      const result = await run("mv", ["-i", "source", "dest"], { fs, stdin: answer });
      assert.equal(result.exitCode, answer === "y\n" ? 0 : 1, result.stderr);
      assert.equal(result.stderr, "mv: overwrite 'dest'? ");
      if (answer === "y\n") assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "new");
      else assert.equal(await fs.readlink("/work/dest"), "referent");
      if (dangling) await assert.rejects(fs.stat("/work/referent"), { code: "ENOENT" });
      else assert.equal(new TextDecoder().decode(await fs.readFile("/work/referent")), "keep");
    });
  }
}

test("mv update and missing destinations do not consume interactive responses", async () => {
  const fs = await fixture({ a: "new-a", b: "new-b", c: "new-c", "dest/a": "old-a", "dest/c": "old-c" });
  for (const name of ["a", "b", "c"]) await fs.utimes(`/work/${name}`, 2000, 2000);
  await fs.utimes("/work/dest/a", 3000, 3000);
  await fs.utimes("/work/dest/c", 1000, 1000);
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  const result = await shell.exec("mv -iu a b c dest", { stdin: "y\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "mv: overwrite 'dest/c'? ");
  for (const name of ["a", "b", "c"]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/dest/${name}`)), `${name === "a" ? "old" : "new"}-${name}`);
  }
});

for (const source of ["missing", "dest", "alias"]) {
  test(`mv interactive rejects invalid source ${source} without reading confirmation`, async () => {
    const fs = await fixture({ dest: "old" });
    await fs.link("/work/dest", "/work/alias");
    const stdin = { [Symbol.asyncIterator](): never { throw new Error("unexpected stdin read"); } };
    const result = await run("mv", ["-i", source, "dest"], { fs, stdin });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(!result.stderr.includes("overwrite"), result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/dest")), "old");
  });
}

test("mv interactive closes the response stream after the final prompt", async () => {
  const fs = await fixture({ source: "new", dest: "old" });
  let closed = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try { yield new TextEncoder().encode("y\nunused\n"); }
    finally { closed = true; }
  } };
  const result = await run("mv", ["-i", "source", "dest"], { fs, stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(closed, true);
});

test("mv cancellation while reading confirmation preserves source, destination, and backup", async () => {
  const fs = await fixture({ source: "new", dest: "old", "dest~": "older" });
  const controller = new AbortController();
  const reason = new Error("cancel confirmation");
  let closed = false;
  const stdin = { async *[Symbol.asyncIterator]() {
    try {
      controller.abort(reason);
      yield new TextEncoder().encode("y\n");
    } finally { closed = true; }
  } };
  await assert.rejects(run("mv", ["-ib", "source", "dest"], { fs, stdin, signal: controller.signal }), error => error === reason);
  assert.equal(closed, true);
  for (const [name, contents] of [["source", "new"], ["dest", "old"], ["dest~", "older"]]) {
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${name}`)), contents);
  }
});

for (const [target, quoted] of [
  ["d'est", '"d\'est"'],
  ["a\\b", "'a\\b'"],
  ["line\nbreak", "'line'$'\\n''break'"],
  ["tab\tname", "'tab'$'\\t''name'"],
  ["café", "'caf'$'\\303\\251'"],
] as const) {
  test(`mv interactive quotes destination ${JSON.stringify(target)} in its prompt`, async () => {
    const fs = await fixture({ source: "new", [target]: "old" });
    const result = await run("mv", ["-i", "source", target], { fs, stdin: "n\n" });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, `mv: overwrite ${quoted}? `);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${target}`)), "old");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "new");
  });
}
