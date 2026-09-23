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
import { run } from "./helpers.js";

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
