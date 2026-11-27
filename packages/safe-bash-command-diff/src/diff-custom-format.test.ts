import assert from "node:assert/strict";
import test from "node:test";
import { evalSyncDiff } from "./sync.js";
import { run } from "./helpers.test-support.js";

for (const buffered of [false, true]) {
  for (const fixture of [
    { name: "line prefixes", args: ["--old-line-format=-%L", "--new-line-format=+%L", "--unchanged-line-format= %L"], expected: " a\n-b\n+c\n" },
    { name: "changed new groups", args: ["--unchanged-group-format=", "--changed-group-format=%>"], expected: "c\n" },
    { name: "all lines", args: ["--line-format=%L"], expected: "a\nb\nc\n" },
    { name: "only added lines", args: ["--unchanged-line-format=", "--old-line-format=", "--new-line-format=%L"], expected: "c\n" },
    { name: "default changed group combines overrides", args: ["--old-group-format=old:%<", "--new-group-format=new:%>"], expected: "a\nold:b\nnew:c\n" },
    { name: "line numbers and escapes", args: ["--line-format=%03dn:%l%% %c'\\101'\n"], expected: "001:a% A\n002:b% A\n002:c% A\n" },
    { name: "group numbers", args: ["--unchanged-group-format=", "--changed-group-format=%df,%dl,%dn,%de,%dm:%dF,%dL,%dN,%dE,%dM\n%<%>"], expected: "2,2,1,1,3:2,2,1,1,3\nb\nc\n" },
    { name: "group conditional", args: ["--unchanged-group-format=", "--changed-group-format=%(n=1?one:%dn lines):%(N=1?%>:many)"], expected: "one:c\n" },
    { name: "separate argument", args: ["--line-format", "%L"], expected: "a\nb\nc\n" },
  ]) test(`custom diff ${fixture.name}, buffered=${buffered}`, async () => {
    const result = await run("diff", ["-I", "^NEVER$", ...fixture.args, "old", "new"], { buffered, files: { old: "a\nb\n", new: "a\nc\n" } });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, fixture.expected);
  });

  for (const fixture of [
    { old: "", next: "new", args: ["--changed-group-format=C:%>"], expected: "C:new\n", status: 1 },
    { old: "old", next: "", args: ["--changed-group-format=C:%<"], expected: "C:old\n", status: 1 },
    { old: "old", next: "new", args: ["--new-line-format=+%L"], expected: "old\n+new", status: 1 },
    { old: "same", next: "same", args: ["--line-format=%dn:%L"], expected: "1:same", status: 0 },
    { old: "old", next: "new", args: ["--line-format=%L"], expected: "oldnew", status: 1 },
    { old: "", next: "new\n", args: ["--new-group-format=+%>"], expected: "+new\n", status: 1 },
    { old: "old\n", next: "", args: ["--old-group-format=-%<"], expected: "-old\n", status: 1 },
    { old: "a\n\nb\n", next: "a\nb\n", args: ["-B", "--unchanged-group-format=[%=]"], expected: "[a\n\nb\n]", status: 0 },
    { old: "A\n", next: "a\n", args: ["-i", "--unchanged-group-format=%<|%>|%="], expected: "A\n|a\n|A\n", status: 0 },
  ]) test(`custom diff line preservation ${JSON.stringify(fixture)}, buffered=${buffered}`, async () => {
    const result = await run("diff", ["-I", "^NEVER$", ...fixture.args, "old", "new"], { buffered, files: { old: fixture.old, new: fixture.next } });
    assert.equal(result.exitCode, fixture.status, result.stderr);
    assert.equal(result.stdout, fixture.expected);
  });
}

for (const args of [["-u", "--line-format=%L"], ["--line-format=A", "--new-line-format=B"], ["--changed-group-format=A", "--changed-group-format=B"], ["--line-format"]]) {
  test(`custom diff rejects invalid options: ${JSON.stringify(args)}`, async () => {
    const result = await run("diff", args.at(-1) === "--line-format" ? args : [...args, "old", "new"], { files: { old: "a", new: "b" } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });
}

for (const options of [{ maxOutputBytes: 2 }, { maxWork: 10 }, { maxHunks: 1 }, { maxLines: 1 }]) {
  test(`custom diff preserves atomic resource limits: ${JSON.stringify(options)}`, async () => {
    const result = await run("diff", ["--line-format=%L", "old", "new"], { files: { old: "a\nb\nc\n", new: "A\nb\nC\n" }, options });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /limit/u);
  });
}

for (const args of [["--line-format=%L"], ["--unchanged-group-format=%="], ["-w", "--line-format=%L"]]) {
  test(`custom diff bypasses the synchronous equal-input shortcut: ${args.join(" ")}`, () => {
    assert.equal(evalSyncDiff(undefined, [...args, "old", "new"], () => Buffer.from("same\n")), undefined);
  });
}

test("custom diff preserves input bytes and octal character escapes", async () => {
  for (const buffered of [false, true]) {
    const chunks: Uint8Array[] = [];
    const result = await run("diff", ["-I", "^NEVER$", "--line-format=%L%c'\\377'", "old", "new"], {
      buffered, files: { old: new Uint8Array([0xfe, 10]), new: new Uint8Array([0xfd]) },
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
    });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([0xfe, 10, 0xff, 0xfd, 0xff]));
  }
});

test("custom diff streams long lines and expands tabs", async () => {
  const text = "x".repeat(70_000) + "\tend\n";
  const result = await run("diff", ["-t", "--line-format=%L", "old", "new"], { files: { old: text, new: text } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "x".repeat(70_000) + "        end\n");
});
