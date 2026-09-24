import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { commandRuntimeIdentity, createCommandArguments, FsError } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { Shell } from "../../../src/shell/index.js";
import { createMikeYqCommand, createMikeYqCommands, mikeYqCommands } from "../../../src/commands/yq/mike.js";
import type { MikeYqOptions } from "../../../src/commands/yq/mike.js";
import { native, nativeOptions, run } from "./helpers.js";

test("Mike yq expressions require double-quoted string literals", async () => {
  assert.deepEqual(await run([".a == 'foo'"], "a: foo\n"), {
    status: 1, stdout: "", stderr: `Error: 1:7: lexer: invalid input text "'foo'"\n`,
  });
  assert.deepEqual(await run(['.a == "foo"'], "a: foo\n"), { status: 0, stdout: "true\n", stderr: "" });
});

test("native Mike yq also rejects single-quoted expression literals", nativeOptions, async () => {
  assert.deepEqual(await native([".a == 'foo'"], "a: foo\n"), {
    status: 1, stdout: "", stderr: `Error: 1:7: lexer: invalid input text "'foo'"\n`,
  });
});

for (const [expression, input, stdout] of [
  [". or false", "true\n", "true\n"],
  [". and true", "false\n", "false\n"],
  [". tag", "123\n", "!!int\n"],
  [". style", "[1, 2]\n", "flow\n"],
  [".or", "{or: value}\n", "value\n"],
  ['."tag"', "{tag: value}\n", "value\n"],
] as const) test(`Mike yq distinguishes identity operators from fields: ${expression}`, async () => {
  assert.deepEqual(await run([expression], input), { status: 0, stdout, stderr: "" });
});

test("Mike yq issue 459 accepts snake-case document and file index aliases", async () => {
  for (const expression of ["document_index", "file_index"]) {
    assert.deepEqual(await run([expression], "changed: Independent\n"), {
      status: 0, stdout: "0\n", stderr: "",
    });
  }
});

test("Mike yq issue 459 aliases preserve indices across documents and files", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first.yaml", Buffer.from("name: first\n---\nname: second\n"));
  await fs.writeFile("/second.yaml", Buffer.from("name: third\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    for (const mode of ["eval", "eval-all"]) {
      for (const [alias, canonical, expected] of [
        ["document_index", "documentIndex", [0, 1, 0]],
        ["file_index", "fileIndex", [0, 0, 1]],
      ] as const) {
        const result = await shell.exec(`yq ${mode} '${alias}' first.yaml second.yaml`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdout.split("\n").filter(line => line && line !== "---").map(Number), expected);
        assert.deepEqual(result, await shell.exec(`yq ${mode} '${canonical}' first.yaml second.yaml`));
      }
    }
    const combined = await shell.exec("yq '[document_index, file_index]' second.yaml");
    assert.equal(combined.exitCode, 0);
    assert.equal(combined.stdout, "- 0\n- 0\n");
    assert.equal(combined.stderr, "");
  } finally { await shell.dispose(); }
});

for (const [name, input, stdout] of [
  ["mapping", "owned: 1\nnested:\n  leaf: value\n", "owned: 1\nnested:\n  leaf: value\nowned\n1\nnested\nleaf: value\nleaf\nvalue\n"],
  ["sequence", "- owned\n- nested: value\n", "- owned\n- nested: value\nowned\nnested: value\nnested\nvalue\n"],
  ["scalar", "OwnedScalar\n", "OwnedScalar\n"],
  ["empty", "", "\n"],
]) test(`Mike yq issue 456 recursively includes mapping keys for ${name}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/payload.yaml", Buffer.from(input!));
  const internalErrors: unknown[] = [];
  const shell = new Shell({ fs, onInternalError: error => { internalErrors.push(error); } }).use(mikeYqCommands());
  try {
    const result = await shell.exec("yq ... payload.yaml");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
    assert.deepEqual(internalErrors, []);
  } finally { await shell.dispose(); }
});

test("Mike yq issue 456 composes key-inclusive descent and preserves value-only descent", async () => {
  assert.deepEqual(await run(['[... | select(tag == "!!str")]'], "a: b\n"), {
    status: 0, stdout: "- a\n- b\n", stderr: "",
  });
  assert.deepEqual(await run([".."], "a: b\n"), { status: 0, stdout: "a: b\nb\n", stderr: "" });
});

test("Mike yq issue 456 reports malformed trailing fields without internal errors", async () => {
  for (const expression of ["... .", ".. .", ".a."]) {
    const result = await run([expression], "a: b\n");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bad expression/);
  }
});

test("structural path preserves candidate ancestry and alias location", async () => {
  const input = "changed:\n- name: Independent\nbase: &base\n  name: Original\ncopy: *base\n7: numeric\n";
  for (const [query, expected] of [
    ["path", "[]\n"],
    [".changed[0].name | path", '["changed",0,"name"]\n'],
    [".changed[-1].name | path", '["changed",0,"name"]\n'],
    [".changed[] | .name | path", '["changed",0,"name"]\n'],
    [".copy.name | path", '["copy","name"]\n'],
    [".[7] | path", '[7]\n'],
    [".. | path", '[]\n["changed"]\n["changed",0]\n["changed",0,"name"]\n["base"]\n["base","name"]\n["copy"]\n[7]\n'],
  ]) {
    assert.deepEqual(await run(["-o=json", "-I=0", query!], input), { status: 0, stdout: expected, stderr: "" });
  }
  assert.deepEqual(await run([".changed[0].name | path"], input), { status: 0, stdout: "- changed\n- 0\n- name\n", stderr: "" });
});

test("structural path honors allocation and output limits", async () => {
  for (const limits of [{ maxNodes: 8 }, { maxOutputBytes: 2 }]) {
    const result = await run([".changed[0].name | path"], "changed:\n- name: Independent\n", {}, { limits });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("limit exceeded"), result.stderr);
  }
});

for (const flag of ["--security-disable-env-ops", "--security-disable-file-ops"]) {
  test(`Mike yq accepts ${flag} for ordinary input files`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.yaml", Buffer.from("a: 1\n"));
    const shell = new Shell({ fs }).use(mikeYqCommands());
    try {
      for (const mode of ["", "eval", "eval-all"]) {
        const result = await shell.exec(`yq ${mode} ${flag} . /input.yaml`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "a: 1\n");
        assert.equal(result.stderr, "");
      }
    } finally { await shell.dispose(); }
  });
}

test("Mike yq disables environment operators before reading input or publishing effects", async () => {
  for (const expression of ["env(VALUE)", "strenv(VALUE)", "select(false) | env(VALUE)", '.a = strenv(VALUE)']) {
    let reads = 0;
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.yaml", Buffer.from("a: 1\n"));
    const result = await run(["--security-disable-env-ops", "-i", expression, "/input.yaml"], "", {
      fs: Object.assign(Object.create(fs) as typeof fs, {
        readFile: async (...args: Parameters<typeof fs.readFile>) => { reads++; return fs.readFile(...args); },
        readStream: (...args: Parameters<NonNullable<typeof fs.readStream>>) => { reads++; return fs.readStream!(...args); },
      }),
      env: { VALUE: "secret" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /env operations have been disabled/u);
    assert.equal(reads, 0);
    assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), "a: 1\n");
  }
});

test("Mike yq security booleans are invocation-local and accept explicit false", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands());
  try {
    assert.equal((await shell.exec("yq -n --security-disable-env-ops 'strenv(VALUE)'", { env: { VALUE: "secret" } })).exitCode, 1);
    for (const flag of ["", "--security-disable-env-ops=false", "--security-disable-file-ops"]) {
      const result = await shell.exec(`yq -n ${flag} 'strenv(VALUE)'`, { env: { VALUE: "secret" } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "secret\n");
    }
    const data = await shell.exec('yq -n --security-disable-env-ops \'{"env": "strenv(VALUE)"}\'');
    assert.equal(data.exitCode, 0, data.stderr);
    assert.equal(data.stdout, "env: strenv(VALUE)\n");
  } finally { await shell.dispose(); }
});

test("Mike yq disabled file operators perform no external reads", async () => {
  for (const operator of ["load", "load_str", "load_xml", "load_props", "load_base64"]) {
    let reads = 0;
    const fs = createMemoryFileSystem();
    const result = await run(["-n", "--security-disable-file-ops", `${operator}("private.yaml")`], "", {
      fs: Object.assign(Object.create(fs) as typeof fs, {
        readFile: async (...args: Parameters<typeof fs.readFile>) => { reads++; return fs.readFile(...args); },
        readStream: (...args: Parameters<NonNullable<typeof fs.readStream>>) => { reads++; return fs.readStream!(...args); },
      }),
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /file operations have been disabled/u);
    assert.equal(reads, 0);
  }
});

test("Mike yq security flags cover expressions loaded from files and split output names", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/expression.yq", Buffer.from("strenv(VALUE)"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    for (const args of ["--from-file /expression.yq", "--split-exp 'strenv(VALUE)' .", "--split-exp-file /expression.yq ."]) {
      const result = await shell.exec(`yq -n --security-disable-env-ops ${args}`, { env: { VALUE: "leaked" } });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /env operations have been disabled/u);
      await assert.rejects(fs.stat("/leaked.yml"), (error: unknown) => error instanceof FsError && error.code === "ENOENT");
    }
  } finally { await shell.dispose(); }
});

interface InplaceMetadata {
  type: "file" | "symlink";
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  ino: number;
  bytesHex?: string;
  readlink?: string;
}
interface InplaceCapture {
  requestSha256: string;
  executableSha256: string;
  cases: {
    id: string; args: string[]; status: number; stdoutHex: string; stderrHex: string;
    before: Record<string, InplaceMetadata>; after: Record<string, InplaceMetadata>;
    temporaryAfter: Record<string, InplaceMetadata>;
  }[];
}
const inplaceBytes = await readFile(new URL("./ORACLE_INPLACE_ROOT.json", import.meta.url));
const inplaceCapture = JSON.parse(inplaceBytes.toString()) as InplaceCapture;
const requestBytes = await readFile(new URL("./INPLACE_REQUEST.json", import.meta.url));
const inplaceRequest = JSON.parse(requestBytes.toString()) as { cases: {
  id: string; args: string[]; files: Record<string, string>; modes?: Record<string, string>;
  symlinks?: Record<string, string>; hardlinks?: Record<string, string>;
}[] };

test("root in-place evidence retains exact capture, binding and case membership", () => {
  assert.equal(createHash("sha256").update(inplaceBytes).digest("hex"), "ffb6e840b17b284c49f70c0e53e8c90ba1d39e8f3cb164e0aa785832d30f4fff");
  assert.equal(inplaceCapture.executableSha256, "877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213");
  assert.equal(createHash("sha256").update(requestBytes).digest("hex"), inplaceCapture.requestSha256);
  assert.deepEqual(inplaceCapture.cases.map(entry => entry.id), ["comment-style-mode", "eval-first-file", "eval-all-first-file", "symlink", "hardlink", "invalid-query", "invalid-yaml", "no-match", "later-input-failure", "empty-assignment", "empty-identity", "no-match-without-exit-status", "later-document-failure", "readonly-original-mode"]);
  assert.deepEqual(inplaceRequest.cases.map(entry => entry.id), inplaceCapture.cases.map(entry => entry.id));
  assert.deepEqual(inplaceCapture.cases.filter(entry => Object.keys(entry.temporaryAfter).length).map(entry => entry.id), ["invalid-query", "invalid-yaml", "no-match", "later-input-failure", "later-document-failure"]);
});

for (const capture of inplaceCapture.cases) test(`root-captured in-place effects: ${capture.id}`, async () => {
  const request = inplaceRequest.cases.find(entry => entry.id === capture.id)!;
  assert.deepEqual(request.args, capture.args);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work"); await fs.mkdir("/tmp");
  for (const [name, text] of Object.entries(request.files)) await fs.writeFile(`/work/${name}`, Buffer.from(text), { mode: Number.parseInt(request.modes?.[name] ?? "0644", 8) });
  for (const [name, target] of Object.entries(request.symlinks ?? {})) await fs.symlink(target, `/work/${name}`);
  for (const [name, target] of Object.entries(request.hardlinks ?? {})) await fs.link(`/work/${target}`, `/work/${name}`);
  const before = new Map<string, Awaited<ReturnType<typeof fs.lstat>>>();
  for (const name of Object.keys(capture.before)) before.set(name, await fs.lstat(`/work/${name}`));
  const result = await run(request.args, "", { fs, cwd: "/work", env: { TMPDIR: "/tmp" } });
  assert.equal(result.status, capture.status);
  assert.equal(Buffer.from(result.stdout).toString("hex"), capture.stdoutHex);
  assert.equal(Buffer.from(result.stderr).toString("hex"), capture.stderrHex);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(capture.after).sort());
  assert.deepEqual(await fs.readdir("/tmp"), []);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["tmp", "work"]);
  for (const [name, expected] of Object.entries(capture.after)) {
    const actual = await fs.lstat(`/work/${name}`);
    const previous = before.get(name)!;
    const nativeBefore = capture.before[name]!;
    assert.equal(actual.type, expected.type);
    assert.equal(actual.nlink, expected.nlink);
    assert.equal(actual.ino === previous.ino, expected.ino === nativeBefore.ino, `${name}: inode replacement relation`);
    assert.equal(actual.uid === previous.uid, expected.uid === nativeBefore.uid, `${name}: owner preservation relation`);
    assert.equal(actual.gid === previous.gid, expected.gid === nativeBefore.gid, `${name}: group preservation relation`);
    if (expected.type === "file") {
      assert.equal(actual.mode & 0o7777, expected.mode);
      assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex"), expected.bytesHex);
    } else {
      assert.equal(actual.mode, previous.mode);
      assert.equal(expected.mode, nativeBefore.mode);
      assert.equal(await fs.readlink(`/work/${name}`), expected.readlink);
    }
  }
});

test("native factories have runtime identity and remain explicit plugins", async () => {
  assert.equal(createMikeYqCommand().runtimeIdentity, commandRuntimeIdentity);
  assert.equal(createMikeYqCommands()[0]!.runtimeIdentity, commandRuntimeIdentity);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands());
  try { assert.equal((await shell.exec("yq -n '.a = 1'")).stdout, "a: 1\n"); }
  finally { await shell.dispose(); }
});

test("keys drops the mapping header without changing source comments", async () => {
  const fs = createMemoryFileSystem();
  const input = "# head\na: 1\n";
  await fs.writeFile("/input.yaml", Buffer.from(input));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec("yq keys /input.yaml");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "- a\n");
    assert.equal(result.stderr, "");
    assert.equal((await shell.exec("yq . /input.yaml")).stdout, input);
    assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), input);
  } finally { await shell.dispose(); }
});

for (const input of ["", "a: 1\n", "---\n", "null\n"]) test(`filename metadata for YAML input ${JSON.stringify(input)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from(input));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec("yq filename input.yaml");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, input === "" ? "\n" : "input.yaml\n");
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), input);
  } finally { await shell.dispose(); }
});

const metadataCases = [
  { name: "mapping head comment", query: "head_comment", input: "# head\na: 1\n", stdout: "head\n" },
  { name: "node anchor", query: ".a | anchor", input: "a: &base 1\n", stdout: "base\n" },
  { name: "node alias", query: ".b | alias", input: "a: &base 1\nb: *base\n", stdout: "base\n" },
  { name: "alias has no anchor of its own", query: ".b | anchor", input: "a: &base 1\nb: *base\n", stdout: "\n" },
  { name: "unannotated node", query: "head_comment, anchor", input: "a: 1\n", stdout: "\n\n" },
  { name: "scalar alias query retains native lexical value", query: ".a | alias", input: "a: &base 0xF\n", stdout: "0xF\n" },
  { name: "equal-valued anchors retain distinct names", query: "[.a, .b, .c, .d] | .[] | alias", input: "a: &first 1\nb: *first\nc: &second 1\nd: *second\n", stdout: "1\nfirst\n1\nsecond\n" },
  { name: "recursive aliases do not dereference", query: ".. | alias", input: "&self\na: *self\n", stdout: "\nself\n" },
  { name: "sequence header belongs to the root", query: "[.. | head_comment]", input: "# head\n- one\n# second\n- two\n", stdout: '- head\n- ""\n- second\n' },
  { name: "root and first item comments stay separate", query: "[.. | head_comment]", input: "# head\n- # first\n  one\n", stdout: '- head\n- first\n' },
  { name: "nested sequence header belongs to its first item", query: "[.. | head_comment]", input: "a:\n  # first\n  - one\n", stdout: '- ""\n- ""\n- first\n' },
  { name: "mapping key comments do not become value comments", query: "[.. | head_comment]", input: "a:\n  # key\n  b: one\n", stdout: '- ""\n- ""\n- ""\n' },
  { name: "scalar value head comment", query: ".a | head_comment", input: "a:\n  # value\n  one\n", stdout: "value\n" },
  { name: "alias uses its own head comment", query: ".b | head_comment", input: "a:\n  # target\n  &base one\nb:\n  # reference\n  *base\n", stdout: "reference\n" },
  { name: "document header preserves whitespace", query: "head_comment", input: "# before\n\n---\n\n# after\na: 1\n", stdout: "before\n\n\nafter\n" },
  { name: "head comment spacing and empty comment lines", query: "head_comment", input: "# first\n#  indented  \n#\n# last\na: 1\n", stdout: "first\n indented  \n#\nlast\n" },
  { name: "later mapping header stays on its key", query: "head_comment", input: "# first\na: 1\n---\n# second\nb: 2\n", stdout: "first\n\n" },
  { name: "cloned sequence item retains its own annotation", query: "[.[0]] | .[] | head_comment", input: "# root\n- # first\n  one\n", stdout: "first\n" },
  { name: "comment-only document", query: "head_comment", input: "# hi\n", stdout: "hi\n" },
  { name: "CRLF header bytes", query: "head_comment", input: "#one\r\n#two\r\na: 1\r\n", stdout: "#one\r\n#two\r\n" },
  { name: "inline document marker header", query: "head_comment", input: "--- # inline\n# root\na: 1\n", stdout: "inline# root\n" },
  { name: "YAML directive in leading content", query: "head_comment", input: "%YAML 1.2\n# directive comment\n---\n# root\na: 1\n", stdout: "%YAML 1.2\ndirective comment\nroot\n" },
  { name: "incoming nonempty head comment takes precedence", query: ".a = .b | .a | head_comment", input: "a:\n # old\n one\nb:\n # new\n two\n", stdout: "new\n" },
  { name: "unannotated replacement retains previous head comment", query: '.a = "new" | .a | head_comment', input: "a:\n # old\n one\n", stdout: "old\n" },
] as const;

for (const entry of metadataCases) test(`YAML metadata query: ${entry.name}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from(entry.input));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`yq '${entry.query}' /input.yaml`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, entry.stdout);
  assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), entry.input);
});

test("YAML metadata expectations match native Mike yq", nativeOptions, async () => {
  for (const entry of metadataCases) assert.deepEqual(await native([entry.query], entry.input), {
    status: 0, stdout: entry.stdout, stderr: "",
  }, entry.name);
});

test("recursive descent emits aliases without traversing their targets", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("a: &base\n  x: 1\nb: *base\n"));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec("yq .. input.yaml");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "a: &base\n  x: 1\nb: *base\n&base\nx: 1\n1\n*base\n");
  } finally { await shell.dispose(); }
});

for (const entry of [
  { query: "[..] | length", input: "a: &base [1, 2]\nb: *base\n", count: 5 },
  { query: "[..] | length", input: "&base\nself: *base\n", count: 2 },
  { query: ".b[]", input: "a: &base [1, 2]\nb: *base\n", count: undefined },
]) test(`alias traversal control: ${entry.query} ${entry.input}`, async () => {
  assert.deepEqual(await run([entry.query], entry.input), {
    status: 0, stdout: entry.count === undefined ? "1\n2\n" : `${entry.count}\n`, stderr: "",
  });
});

for (const fixture of [
  { name: "absent value on false", expression: '{"name": .name}', input: "false\n", stdout: "" },
  { name: "absent value on a string", expression: '{"name": .name}', input: "hello\n", stdout: "" },
  { name: "filtered value", expression: '{"name": select(false)}', input: "name: Ada\n", stdout: "" },
  { name: "explicit empty object", expression: '{}', input: "false\n", stdout: "{}\n" },
  { name: "missing mapping member yields null", expression: '{"name": .name}', input: "{}\n", stdout: "name: null\n" },
  { name: "explicit null member", expression: '{"name": .name}', input: "name: null\n", stdout: "name: null\n" },
  { name: "present member", expression: '{"name": .name}', input: "name: Ada\n", stdout: "name: Ada\n" },
]) test(`object construction: ${fixture.name}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from(fixture.input));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`yq '${fixture.expression}' input.yaml`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, fixture.stdout);
});

test("native factories reject malformed options and snapshot plugin replacement", async () => {
  for (const options of [{ unknown: true }, { replace: 1 }, { limits: [] }]) assert.throws(() => createMikeYqCommand(options as MikeYqOptions), TypeError);
  const options = { replace: false };
  const plugin = mikeYqCommands(options);
  options.replace = true;
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands());
  try { shell.use(plugin); await assert.rejects(shell.exec("yq -n ."), /Command already registered/u); }
  finally { await shell.dispose(); }
});

test("version is truthful and separate from native identity", async () => {
  assert.deepEqual(await run(["--version"]), { status: 0, stdout: "yq (safe-bash; bounded Mike Farah v4.53.3 profile)\n", stderr: "" });
});

test("in-place preserves comments, quote style and mode", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("# heading\na: 'old' # inline\n"), { mode: 0o640 });
  assert.deepEqual(await run(["-i", '.a = "new"', "/input.yaml"], "", { fs }), { status: 0, stdout: "", stderr: "" });
  assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), "# heading\na: 'new' # inline\n");
  assert.equal((await fs.stat("/input.yaml")).mode & 0o777, 0o640);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.yaml"]);
});

for (const all of [false, true]) test(`in-place replaces only first file (all=${all})`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first.yaml", Buffer.from("a: 1\n"));
  await fs.writeFile("/second.yaml", Buffer.from("b: 2\n"));
  const args = all ? ["ea", "-i", "select(fi == 0) * select(fi == 1)", "/first.yaml", "/second.yaml"] : ["-i", ".", "/first.yaml", "/second.yaml"];
  assert.equal((await run(args, "", { fs })).status, 0);
  assert.equal(Buffer.from(await fs.readFile("/first.yaml")).toString(), all ? "a: 1\nb: 2\n" : "a: 1\n---\nb: 2\n");
  assert.equal(Buffer.from(await fs.readFile("/second.yaml")).toString(), "b: 2\n");
});

test("in-place follows symlink but regular rename breaks a hardlink", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/original", Buffer.from("a: 1\n"));
  await fs.symlink("/original", "/symlink");
  await fs.link("/original", "/hardlink");
  assert.equal((await run(["-i", ".a = 2", "/symlink"], "", { fs })).status, 0);
  assert.equal((await fs.lstat("/symlink")).type, "symlink");
  assert.equal(Buffer.from(await fs.readFile("/hardlink")).toString(), "a: 2\n");
  assert.equal((await run(["-i", ".a = 3", "/original"], "", { fs })).status, 0);
  assert.equal(Buffer.from(await fs.readFile("/hardlink")).toString(), "a: 2\n");
});

for (const query of ["[", "select(false)"]) test(`failure leaves input and no temp files: ${query}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  const result = await run(["-i", "-e", query, "/input"], "", { fs });
  assert.equal(result.status, 1);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 1\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});

test("rename refusal falls back to copying and removes staging file", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  context.mock.method(fs, "rename", async () => { throw new FsError("EXDEV"); });
  assert.equal((await run(["-i", ".a = 2", "/input"], "", { fs })).status, 0);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 2\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});

test("quota refusal preserves original bytes without a giant allocation", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("a: 1\n"));
  const write = fs.writeFile.bind(fs);
  context.mock.method(fs, "writeFile", async (...args: Parameters<typeof write>) => {
    if (args[1].length > 8) throw new FsError("ENOSPC");
    return write(...args);
  });
  assert.equal((await run(["-i", '.a = "longer"', "/input"], "", { fs })).status, 1);
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a: 1\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
});

test("raw invalid filename never aliases a replacement filename", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/�", Buffer.from("a: 1\n"));
  const argumentValues = createCommandArguments(["-i", ".a = 2", shellValueFromBytes(Uint8Array.of(255))]);
  assert.equal((await run(argumentValues.args, "", { fs, argumentValues })).status, 1);
  assert.equal(Buffer.from(await fs.readFile("/�")).toString(), "a: 1\n");
});

test("path traversal retains symlink/.. ordering", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/a", { recursive: true }); await fs.mkdir("/b/child", { recursive: true });
  await fs.symlink("/b/child", "/a/link");
  await fs.writeFile("/a/data", Buffer.from("wrong\n")); await fs.writeFile("/b/data", Buffer.from("right\n"));
  assert.equal((await run([".", "link/../data"], "", { fs, cwd: "/a" })).stdout, "right\n");
});

for (const fixture of [
  { command: 'yq --from-file=expression.yq input.yaml', stdout: '1\n' },
  { command: 'yq --header-preprocess=false . input.yaml', stdout: 'a: 1\n' },
  { command: 'yq --front-matter=extract . post.md', stdout: '---\na: 1\n' },
  { command: "yq -f process '.a = 2' post.md", stdout: '---\na: 2\n---\nBody\n' },
  { command: `yq --split-exp='"part"' . input.yaml`, stdout: '', file: 'part.yml' },
  { command: 'yq --split-exp-file=split.yq . input.yaml', stdout: '', file: 'nested/part.yml' },
]) test(`Mike yq issue 302: ${fixture.command}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir('/work');
  for (const [name, text] of Object.entries({ 'input.yaml': 'a: 1\n', 'expression.yq': '.a', 'post.md': '---\na: 1\n---\nBody\n', 'split.yq': '"nested/part"' })) {
    await fs.writeFile(`/work/${name}`, Buffer.from(text));
  }
  const shell = new Shell({ fs, cwd: '/work' }).use(mikeYqCommands());
  try {
    const result = await shell.exec(fixture.command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.stderr, '');
    if (fixture.file) assert.equal(Buffer.from(await fs.readFile(`/work/${fixture.file}`)).toString(), 'a: 1\n');
  } finally { await shell.dispose(); }
});

for (const enabled of [true, false]) test(`Mike yq issue 302 header preprocessing ${enabled}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands());
  try {
    const result = await shell.exec(`yq --header-preprocess=${enabled} .`, { stdin: '# header\n---\na: 1\n' });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, enabled ? '# header\n---\na: 1\n' : '# header\na: 1\n');
  } finally { await shell.dispose(); }
});

test('Mike yq issue 302 repeated split names overwrite previous results', async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec(`yq -s '"part"' '.[]'`, { stdin: '- a\n- b\n' });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(Buffer.from(await fs.readFile('/part.yml')).toString(), 'b\n');
  } finally { await shell.dispose(); }
});

test('Mike yq issue 302 refuses split output with inplace without changing input', async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input.yaml', Buffer.from('a: 1\n'));
  const shell = new Shell({ fs }).use(mikeYqCommands());
  try {
    const result = await shell.exec(`yq -i -s '"part"' '.a = 2' input.yaml`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'Error: write in place cannot be used with split file\n');
    assert.equal(Buffer.from(await fs.readFile('/input.yaml')).toString(), 'a: 1\n');
    assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.yaml']);
  } finally { await shell.dispose(); }
});

test('Mike yq issue 302 no-doc suppresses front matter opening separator', async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands());
  try {
    const result = await shell.exec('yq -N -f extract .', { stdin: '---\na: 1\n---\nBody\n' });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'a: 1\n');
  } finally { await shell.dispose(); }
});
