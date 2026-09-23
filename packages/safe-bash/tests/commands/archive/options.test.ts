import assert from "node:assert/strict";
import test from "node:test";
import { archive, binary, fixture, member, record, wrapped } from "./helpers.js";

test("tar lists transformed names only when requested, selecting original names", async () => {
  const { shell } = await fixture();
  try {
    const stdin = archive(member("dir/a.txt", binary), member("dir/b.bin", binary));
    for (const [flags, expected] of [
      ["--show-transformed-names --transform='s/dir/new/'", "new/a.txt\nnew/b.bin\n"],
      ["--transform='s/dir/new/'", "dir/a.txt\ndir/b.bin\n"],
      ["--show-transformed-names", "dir/a.txt\ndir/b.bin\n"],
      ["--show-transformed-names --transform='s/dir/new/' dir/a.txt", "new/a.txt\n"],
      ["--show-transformed-names --transform='s/dir/new/' --exclude='*.bin'", "new/a.txt\n"],
      ["--show-transformed-names --transform='s/dir/new/' --transform='s/new/final/'", "final/a.txt\nfinal/b.bin\n"],
    ]) {
      const result = await shell.exec(`tar -tf - ${flags}`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});

test("listing transforms support bounded BRE captures, flags, escaped delimiters and verbose links", async () => {
  const { shell } = await fixture();
  try {
    const stdin = archive(member("dir/dir/a", binary), member("dir/link", new Uint8Array(), "2", "dir/dir/a"));
    for (const [expression, expected] of [
      ["s/dir/new/g", "new/new/a\nnew/link\n"],
      ["s/DIR/new/i", "new/dir/a\nnew/link\n"],
      ["s#dir/\\(.*\\)#new/\\1#", "new/dir/a\nnew/link\n"],
      ["s#dir/(.*)#new/\\1#x", "new/dir/a\nnew/link\n"],
      ["s/dir\\/dir/new/;s/link/&-copy/", "new/a\ndir/link-copy\n"],
    ]) {
      const result = await shell.exec(`tar -tf - --show-transformed-names --xform='${expression}'`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
    const result = await shell.exec("tar -tvf - --show-transformed-names --transform='s/dir/new/g'", { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("new/link -> new/new/a\n"));
  } finally { await shell.dispose(); }
});

test("invalid or unsupported transforms fail without extraction effects", async () => {
  const { fs, shell } = await fixture();
  try {
    for (const expression of ["", "s/dir/new", "s/dir/new/e", "s/dir/\\1/", "s/dir/\\U&/", "s//new/", "s/[/new/"]) {
      const result = await shell.exec(`tar -tf - --transform='${expression}'`, { stdin: archive(member("dir/a", binary)) });
      assert.equal(result.exitCode, 2, expression);
    }
    const extracted = await shell.exec("tar -xf - -C /out --transform='s/dir/../'", { stdin: archive(member("dir/a", binary)) });
    assert.equal(extracted.exitCode, 2);
    assert.deepEqual(await fs.readdir("/out"), []);
  } finally { await shell.dispose(); }
});

test("transformed listings enforce path and execution budgets", async () => {
  for (const limits of [{ maxPathBytes: 16 }, { maxPatternSteps: 1 }]) {
    const { shell } = await fixture({ limits });
    try {
      const result = await shell.exec("tar -tf - --show-transformed-names --transform='s/a/abcdefghijklmnopq/'", { stdin: archive(member("a", binary)) });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  }
});

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
  const writeStream = fs.writeStream!.bind(fs);
  const utimes = fs.utimes!.bind(fs);
  fs.writeStream = async (path, bytes, options) => {
    await writeStream(path, bytes, options);
    if (path === "/out/original") await utimes(path, 1_600_000_006_250, 1_600_000_007_125, options);
  };
  try {
    const bytes = archive(
      member("global", record("mtime", "1700000100.125"), "g"),
      member("local", Buffer.concat([record("path", "unicode-雪\nfile"), record("mtime", "1700000200.5")]), "x"), member("placeholder", binary),
      member("local", record("mtime", ""), "x"), member("original", binary), member("globaltime", binary),
    );
    const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/out/unicode-雪\nfile")).mtimeMs, 1_700_000_200_500);
    assert.equal((await fs.stat("/out/original")).mtimeMs, 1_600_000_007_125);
    assert.equal((await fs.stat("/out/globaltime")).mtimeMs, 1_700_000_100_125);
  } finally { await shell.dispose(); }
});

for (const flags of ["-cf", "-cxf archive", "-cf archive -z --xz file", "-cf archive -Jj file", "-cf archive --format=zip file", "-cf archive --strip-components=1 file", "-tf - --strip-components=-1", "--create=yes", "cf archive", "-tf - --wildcards", "cf archive file --exclude=foo"]) test(`unsupported/invalid flags are not ignored: ${flags}`, async () => {
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

test("tar creation accepts explicit numeric ownership, mode and timestamps", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", binary);
    const created = await shell.exec("tar -cf archive --mtime=@0 --owner=12 --group 34 --mode=0751 --numeric-owner file");
    assert.equal(created.exitCode, 0, created.stderr);
    const listed = await shell.exec("tar --full-time -tvf archive");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.match(listed.stdout, /12\/34 .*1970-01-01 00:00:00.*file/);
    assert.equal((await shell.exec("tar -xf archive --no-same-owner --same-permissions -C /out")).exitCode, 0);
    const stat = await fs.stat("/out/file");
    assert.equal(stat.mode & 0o777, 0o751);
    assert.equal(stat.mtimeMs, 0);
  } finally { await shell.dispose(); }
});

for (const flags of ["--touch", "-m", "--same-permissions", "--preserve-permissions", "-p", "--no-same-permissions", "--delay-directory-restore", "--no-delay-directory-restore"]) {
  test(`tar extraction policy ${flags}`, async () => {
    const { fs, shell } = await fixture();
    try {
      const result = await shell.exec(`tar -xf - -C /out ${flags}`, { stdin: archive(member("file", binary)) });
      assert.equal(result.exitCode, 0, result.stderr);
      const stat = await fs.stat("/out/file");
      assert.deepEqual(await fs.readFile("/out/file"), binary);
      if (flags === "--touch" || flags === "-m") assert.notEqual(stat.mtimeMs, 1_700_000_000_000);
      else assert.equal(stat.mtimeMs, 1_700_000_000_000);
    } finally { await shell.dispose(); }
  });
}

test("invalid metadata arguments fail before archive publication", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", binary);
    for (const option of ["--mtime=bad", "--owner=-1", "--group=unknown", "--mode=888", "--mtime", "--owner", "--group", "--mode"]) {
      const result = await shell.exec(`tar -cf archive file ${option}`);
      assert.equal(result.exitCode, 2);
      await assert.rejects(fs.stat("/work/archive"));
    }
  } finally { await shell.dispose(); }
});

test("tar preserves source access times when requested", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", binary);
    await fs.utimes!("/work/file", 1000, 2000);
    for (const flag of ["--atime-preserve", "--atime-preserve=replace"]) {
      const result = await shell.exec(`tar -cf archive ${flag} file`);
      assert.equal(result.exitCode, 0, result.stderr);
      const stat = await fs.stat("/work/file");
      assert.equal(stat.atimeMs, 1000);
      assert.equal(stat.mtimeMs, 2000);
    }
  } finally { await shell.dispose(); }
});


test("atime preservation includes directory traversal and file reads", async () => {
  const { fs } = await fixture();
  await fs.mkdir("/work/dir");
  await fs.writeFile("/work/dir/file", binary);
  await fs.utimes!("/work/dir", 1000, 2000);
  await fs.utimes!("/work/dir/file", 3000, 4000);
  const accessed = new Set<string>();
  const filesystem = wrapped(fs, {
    readdir: async (path, options) => { accessed.add(path); return fs.readdir(path, options); },
    readStream: (path, options) => { accessed.add(path); return fs.readStream!(path, options); },
    lstat: async (path, options) => { const stat = await fs.lstat(path, options); return accessed.has(path) ? { ...stat, atimeMs: 9999 } : stat; },
    stat: async (path, options) => { const stat = await fs.stat(path, options); return accessed.has(path) ? { ...stat, atimeMs: 9999 } : stat; },
    utimes: async (path, atime, mtime, options) => { await fs.utimes!(path, atime, mtime, options); accessed.delete(path); },
  });
  const { shell } = await fixture({}, filesystem);
  try {
    const result = await shell.exec("tar -cf archive --atime-preserve dir");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await filesystem.stat("/work/dir")).atimeMs, 1000);
    assert.equal((await filesystem.stat("/work/dir/file")).atimeMs, 3000);
  } finally { await shell.dispose(); }
});

for (const delay of [true, false]) test(`directory restoration ${delay ? "waits for archive end" : "follows subtree completion"}`, async () => {
  const { fs } = await fixture();
  const restored: string[] = [];
  const filesystem = wrapped(fs, {
    chmod: async (path, mode, options) => { restored.push(path); await fs.chmod!(path, mode, options); },
  });
  const { shell } = await fixture({}, filesystem);
  try {
    const bytes = archive(member("dir/", new Uint8Array(), "5"), member("dir/file", binary), member("other", binary));
    const result = await shell.exec(`tar -xf - -C /out --${delay ? "delay" : "no-delay"}-directory-restore`, { stdin: bytes });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(restored, delay ? ["/out/dir/file", "/out/other", "/out/dir"] : ["/out/dir/file", "/out/dir", "/out/other"]);
    assert.equal((await fs.stat("/out/dir")).mtimeMs, 1_700_000_000_000);
  } finally { await shell.dispose(); }
});

test("full-time leaves nonverbose listing bytes unchanged", async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec("tar --full-time -tf -", { stdin: archive(member("dir/file", binary)) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "dir/file\n");
  } finally { await shell.dispose(); }
});
