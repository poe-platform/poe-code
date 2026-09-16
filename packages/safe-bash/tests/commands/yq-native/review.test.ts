import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import test from "node:test";
import { createCommandArguments, FsError, type ByteSource } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { mikeYqCommands } from "../../../src/commands/yq/mike.js";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { native, nativeOptions, run } from "./helpers.js";

const expressions = [
  { query: "select(.a == 1)", input: 'a: "1"\n', stdout: 'a: "1"\n' },
  { query: ".a | length", input: "a: -123\n", stdout: "4\n" },
  { query: ".a = .missing", input: "a: 1\n", stdout: "a: 1\n" },
  { query: ".a + .b", input: "a: null\nb: 3\n", stdout: "3\n" },
] as const;

interface InPlaceRequest {
  readonly id: string;
  readonly args: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly hardlinks?: Readonly<Record<string, string>>;
}

interface CapturedEntry {
  readonly type: "file" | "symlink";
  readonly mode: number;
  readonly nlink: number;
  readonly ino: number;
  readonly bytesHex?: string;
  readonly readlink?: string;
}

interface InPlaceCapture {
  readonly id: string;
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly before: Readonly<Record<string, CapturedEntry>>;
  readonly after: Readonly<Record<string, CapturedEntry>>;
  readonly temporaryAfter: Readonly<Record<string, unknown>>;
}

const requestPath = new URL("./INPLACE_REQUEST.json", import.meta.url);
const evidencePath = new URL("./ORACLE_INPLACE_ROOT.json", import.meta.url);
for (const path of [requestPath, evidencePath]) {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && stat.size <= 1024 * 1024, "review evidence must be bounded regular JSON");
}
const requestBytes = await readFile(requestPath);
const evidenceBytes = await readFile(evidencePath);
assert.equal(createHash("sha256").update(requestBytes).digest("hex"), "c2636c1bddbbf2f0df3aa3844f3b1ac85b52efea7bc0910cc55953ef2406112f");
assert.equal(createHash("sha256").update(evidenceBytes).digest("hex"), "ffb6e840b17b284c49f70c0e53e8c90ba1d39e8f3cb164e0aa785832d30f4fff");
const requests = (JSON.parse(requestBytes.toString()) as { cases: readonly InPlaceRequest[] }).cases;
const captures = (JSON.parse(evidenceBytes.toString()) as { cases: readonly InPlaceCapture[] }).cases;
assert.equal(requests.length, 14);
assert.equal(captures.length, 14);

for (const entry of expressions) {
  test(`review: pinned common expression ${entry.query}`, async () => {
    assert.deepEqual(await run([entry.query], entry.input), { status: 0, stdout: entry.stdout, stderr: "" });
  });
}

test("review: live pinned oracle confirms the four independent expression expectations", nativeOptions, async () => {
  for (const entry of expressions) assert.deepEqual(await native([entry.query], entry.input), {
    status: 0, stdout: entry.stdout, stderr: "",
  });
});

for (const request of requests) {
  test(`review: captured in-place target effects ${request.id}`, async context => {
    const expected = captures.find(entry => entry.id === request.id)!;
    assert.ok(expected);
    if (Object.keys(expected.temporaryAfter).length) context.diagnostic("Known staging-effect gap: native retained temporary entries; this case qualifies target effects only, not full in-place parity.");
    const fs = createMemoryFileSystem();
    for (const [name, text] of Object.entries(request.files)) await fs.writeFile(`/${name}`, Buffer.from(text), { mode: expected.before[name]!.mode });
    for (const [name, target] of Object.entries(request.symlinks ?? {})) await fs.symlink!(target, `/${name}`);
    for (const [name, target] of Object.entries(request.hardlinks ?? {})) await fs.link!(`/${target}`, `/${name}`);
    const before = new Map(await Promise.all(Object.keys(expected.before).map(async name => [name, await fs.lstat(`/${name}`)] as const)));
    assert.deepEqual(await run(request.args, "", { fs }), { status: expected.status, stdout: expected.stdout, stderr: expected.stderr });
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), Object.keys(expected.after).sort());
    for (const [name, entry] of Object.entries(expected.after)) {
      const actual = await fs.lstat(`/${name}`);
      assert.equal(actual.type, entry.type, name);
      assert.equal(actual.nlink, entry.nlink, name);
      assert.equal(actual.ino === before.get(name)!.ino, entry.ino === expected.before[name]!.ino, `${name}: retained versus replaced identity`);
      if (entry.type === "file") {
        assert.equal(actual.mode & 0o7777, entry.mode & 0o7777, name);
        assert.equal(Buffer.from(await fs.readFile(`/${name}`)).toString("hex"), entry.bytesHex, name);
      } else {
        assert.equal(await fs.readlink!(`/${name}`), entry.readlink, name);
        assert.equal(actual.mode, before.get(name)!.mode, `${name}: unchanged virtual symlink mode`);
      }
    }
  });
}

test("review: invalid raw expression bytes are refused before stdin acquisition", async () => {
  const argumentValues = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const stdin: ByteSource = { [Symbol.asyncIterator]() { throw new Error("invalid argv must not acquire input"); } };
  assert.deepEqual(await run(argumentValues.args, "", { argumentValues, stdin }), {
    status: 1, stdout: "", stderr: "Error: yq filename/expression bytes must be valid UTF-8\n",
  });
});

test("review: in-place output-limit refusal preserves the original and leaves no staging entry", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("a: 1\n"));
  const before = await fs.stat("/input.yaml");
  assert.deepEqual(await run(["-i", '.a = "long value"', "/input.yaml"], "", { fs }, { limits: { maxOutputBytes: 5 } }), {
    status: 1, stdout: "", stderr: "Error: yq limit exceeded: maxOutputBytes\n",
  });
  assert.equal((await fs.stat("/input.yaml")).ino, before.ino);
  assert.equal(Buffer.from(await fs.readFile("/input.yaml")).toString(), "a: 1\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input.yaml"]);
});

for (const scenario of [
  { name: "tiny Shell budget rejects staging", limit: 2, prefix: "", suffix: "", fallback: false, fails: true, published: false },
  { name: "prior stdout shares staging budget", limit: 6, prefix: "review-stdout xx; ", suffix: "", fallback: false, fails: true, published: false },
  { name: "prior stdout and staging fit their exact combined budget", limit: 7, prefix: "review-stdout xx; ", suffix: "", fallback: false, fails: false, published: true },
  { name: "rename publishes exactly one five-byte staging write", limit: 5, prefix: "", suffix: "", fallback: false, fails: false, published: true },
  { name: "published staging consumes the later stdout budget", limit: 5, prefix: "", suffix: "; review-stdout x", fallback: false, fails: true, published: true },
  { name: "fallback admission preserves source when its second write exceeds budget", limit: 9, prefix: "", suffix: "", fallback: true, fails: true, published: false },
  { name: "fallback succeeds with both five-byte writes budgeted", limit: 10, prefix: "", suffix: "", fallback: true, fails: false, published: true },
  { name: "fallback charges both writes against later stdout", limit: 10, prefix: "", suffix: "; review-stdout x", fallback: true, fails: true, published: true },
] as const) {
  test(`review: ${scenario.name}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input.yaml", Buffer.from("a: 1\n"), { mode: 0o640 });
    const original = await fs.stat("/input.yaml");
    let renameAttempts = 0;
    if (scenario.fallback) context.mock.method(fs, "rename", async () => { renameAttempts++; throw new FsError("EXDEV"); });
    const shell = new Shell({ fs, limits: { maxOutputBytes: scenario.limit } });
    context.after(() => shell.dispose());
    shell.use(mikeYqCommands({ replace: true }));
    shell.register({ name: "review-stdout", async execute(command) {
      await command.stdout.write(Buffer.from(command.args[0]!));
      return { exitCode: 0 };
    } });
    const script = `${scenario.prefix}yq -i '.a = 2' /input.yaml${scenario.suffix}`;
    const outcome = await shell.exec(script).then(
      result => ({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }),
      error => {
        assert.ok(error instanceof ShellLimitError);
        return { limit: error.limit };
      },
    );
    const after = await fs.stat("/input.yaml");
    assert.deepEqual({
      outcome,
      bytes: Buffer.from(await fs.readFile("/input.yaml")).toString(),
      mode: after.mode & 0o7777,
      retainedIdentity: after.ino === original.ino,
      entries: (await fs.readdir("/")).map(entry => entry.name),
    }, {
      outcome: scenario.fails ? { limit: "maxOutputBytes" } : { exitCode: 0, stdout: scenario.prefix ? "xx" : "", stderr: "" },
      bytes: scenario.published ? "a: 2\n" : "a: 1\n",
      mode: 0o640,
      retainedIdentity: scenario.fallback || !scenario.published,
      entries: ["input.yaml"],
    });
    if (scenario.fallback) assert.equal(renameAttempts, 1);
  });
}

test("review: ordinary Shell stdout is not double charged by yq family accounting", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.yaml", Buffer.from("a: 1\n"));
  const shell = new Shell({ fs, limits: { maxOutputBytes: 5 } });
  context.after(() => shell.dispose());
  shell.use(mikeYqCommands({ replace: true }));
  const result = await shell.exec("yq . /input.yaml");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "a: 1\n");
  assert.equal(result.stderr, "");
});
