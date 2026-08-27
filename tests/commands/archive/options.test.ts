import assert from "node:assert/strict";
import test from "node:test";
import { archive, binary, fixture, member, record } from "./helpers.js";

test("positional -C create and file-list directory changes affect subsequent operands", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/one"); await fs.mkdir("/work/two");
    await fs.writeFile("/work/one/first", binary); await fs.writeFile("/work/two/second", binary);
    await fs.writeFile("/work/names", Buffer.from("-Cone\nfirst\n--directory=../two\nsecond\n"));
    for (const flags of ["-C one first -C ../two second", "-T names"]) {
      const result = await shell.exec(`tar cf archive ${flags}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await shell.exec("tar tf archive")).stdout, "first\nsecond\n");
    }
  } finally { await shell.dispose(); }
});

test("source parent prefixes are stripped without lexically bypassing symlink resolution", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/input/sub", { recursive: true }); await fs.mkdir("/work/other/child", { recursive: true });
    await fs.writeFile("/work/input/file", Buffer.from("input")); await fs.writeFile("/work/other/file", Buffer.from("other"));
    await fs.symlink!("../other/child", "/work/input/alias");
    for (const [argumentsText, expected] of [["-C input/sub ../file", "input"], ["-C input alias/../file", "other"], ["-C input/alias/.. file", "other"]]) {
      const created = await shell.exec(`tar cf archive ${argumentsText}`);
      assert.equal(created.exitCode, 0, created.stderr);
      assert.equal((await shell.exec("tar tf archive")).stdout, "file\n");
      const extracted = await shell.exec("tar xf archive -C /out");
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      assert.equal(Buffer.from(await fs.readFile("/out/file")).toString(), expected);
    }
  } finally { await shell.dispose(); }
});

test("null/verbatim file lists preserve dashes, spaces, backslashes and newlines", async () => {
  const { fs, shell } = await fixture();
  try {
    const names = ["-name", " spaced ", "back\\slash", "line\nname"];
    for (const name of names) await fs.writeFile(`/work/${name}`, binary);
    await fs.writeFile("/work/names", Buffer.from(names.join("\0") + "\0"));
    assert.equal((await shell.exec("tar cf archive --null -T names")).exitCode, 0);
    const extracted = await shell.exec("tar xf archive -C /out");
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    for (const name of names) assert.deepEqual(await fs.readFile(`/out/${name}`), binary);
    const result = await shell.exec("tar cf - --verbatim-files-from -T -", { stdin: "-name\n spaced \nback\\slash\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await shell.exec("tar tf -", { stdin: result.stdoutBytes })).stdout, "-name\n spaced \nback\\\\slash\n");
  } finally { await shell.dispose(); }
});

test("default files-from preserves spaces according to pinned GNU observation", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/ spaced ", binary);
    const result = await shell.exec("tar cf - -T -", { stdin: " spaced \n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await shell.exec("tar tf -", { stdin: result.stdoutBytes })).stdout, " spaced \n");
  } finally { await shell.dispose(); }
});

test("explicit empty files-from creates a real empty archive", async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("tar cf - -T -", { stdin: "" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdoutBytes.length, 1024);
    assert.equal((await shell.exec("tar tf -", { stdin: result.stdoutBytes })).exitCode, 0);
  } finally { await shell.dispose(); }
});

test("excludes match components/globs and selected members retain directory descendants", async () => {
  const { shell } = await fixture();
  try {
    const bytes = archive(member("tree/keep.txt", binary), member("tree/sub/a.tmp", binary), member("tree/drop/b.txt", binary), member("elsewhere", binary));
    for (const [flags, expected] of [["tree --exclude='*.tmp' --exclude=drop", "tree/keep.txt\n"], ["--exclude='[!e]*'", "elsewhere\n"], ["--exclude='tree/?eep.txt' --exclude='*.tmp' --exclude=drop", "elsewhere\n"]]) {
      const result = await shell.exec(`tar tf - ${flags}`, { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    assert.equal((await shell.exec("tar tf - missing", { stdin: bytes })).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("strip-components uses original names for selectors/excludes, including ./", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("./tree/keep", binary), member("./tree/drop", binary));
    const result = await shell.exec("tar xf - -C /out --strip-components=2 --exclude='*/drop' ./tree", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/out/keep"), binary);
    assert.equal((await fs.readdir("/out")).length, 1);
    assert.equal((await shell.exec("tar tf - --strip-components=2", { stdin: bytes })).stdout, "./tree/keep\n./tree/drop\n");
  } finally { await shell.dispose(); }
});

test("PAX global/local precedence, deletion and embedded newline", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(
      member("global", record("mtime", "1700000100.125"), "g"),
      member("local", Buffer.concat([record("path", "unicode-雪\nfile"), record("mtime", "1700000200.5")]), "x"), member("placeholder", binary),
      member("local", record("mtime", ""), "x"), member("original", binary), member("globaltime", binary),
    );
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/out/unicode-雪\nfile")).mtimeMs, 1_700_000_200_500);
    assert.equal((await fs.stat("/out/original")).mtimeMs, 1_700_000_000_000);
    assert.equal((await fs.stat("/out/globaltime")).mtimeMs, 1_700_000_100_125);
  } finally { await shell.dispose(); }
});

for (const flags of ["-cf", "-cxf archive", "-cf archive --xz file", "-cf archive -j file", "-cf archive --format=zip file", "-cf archive --strip-components=1 file", "-tf - --strip-components=-1", "--create=yes", "cf archive", "-tf - --wildcards", "cf archive file --exclude=foo"]) test(`unsupported/invalid flags are not ignored: ${flags}`, async () => {
  const { shell } = await fixture();
  try { assert.equal((await shell.exec(`tar ${flags}`, { stdin: archive() })).exitCode, 2); }
  finally { await shell.dispose(); }
});

test("unsupported file-list grammar and stream reuse fail explicitly", async () => {
  const { shell } = await fixture();
  try {
    for (const contents of ["--checkpoint-action=exec=bad\n", "-C dir\n", "back\\slash\n", "nul\0name"]) {
      const result = await shell.exec("tar cf - -T -", { stdin: contents });
      assert.equal(result.exitCode, 2, result.stderr);
    }
    assert.equal((await shell.exec("tar tf - -T -", { stdin: "file\n" })).exitCode, 2);
    assert.equal((await shell.exec("tar cf - -T - -T -", { stdin: "" })).exitCode, 2);
  } finally { await shell.dispose(); }
});
