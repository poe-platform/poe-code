import assert from "node:assert/strict";
import test from "node:test";
import { MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";
import { archive, binary, direct, fixture, gate, member, record, source, wrapped } from "./helpers.js";

for (const backend of ["memory", "s3-mock"]) test(`stdout extraction on ${backend} accepts short, long and traditional options without publishing members`, async () => {
  const adapter = backend === "s3-mock" ? new S3FileSystem({ bucket: "bucket", transport: new MockS3Client({ buckets: ["bucket"] }) }) : undefined;
  const { fs, shell } = await fixture({}, adapter);
  try {
    const bytes = archive(member("dir/", undefined, "5"), member("dir/record", binary), member("other", Uint8Array.of(0, 255, 10)), member("link", undefined, "2", "dir/record"), member("hard", undefined, "1", "dir/record"));
    await fs.writeFile("/work/owned.tar", bytes);
    await fs.mkdir("/work/dir");
    await fs.writeFile("/work/dir/record", Buffer.from("existing"));
    const before = await fs.stat("/work/dir/record");
    for (const flags of ["-xOf", "-x -O -f", "--extract --to-stdout --file", "xOf"]) {
      const result = await shell.exec(`tar ${flags} owned.tar dir/record`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, binary);
    }
    const all = await shell.exec("tar -xOvf owned.tar");
    assert.equal(all.exitCode, 0, all.stderr);
    assert.deepEqual(all.stdoutBytes, new Uint8Array(Buffer.concat([binary, Uint8Array.of(0, 255, 10)])));
    assert.match(all.stderr, /dir\/record\n/u);
    assert.equal(Buffer.from(await fs.readFile("/work/dir/record")).toString(), "existing");
    const after = await fs.stat("/work/dir/record");
    assert.equal(after.mode, before.mode);
    assert.equal(after.mtimeMs, before.mtimeMs);
    await assert.rejects(fs.stat("/work/other"), { code: "ENOENT" });
    const piped = await shell.exec("cat owned.tar | tar -xOf - dir/record > recovered");
    assert.equal(piped.exitCode, 0, piped.stderr);
    assert.deepEqual(await fs.readFile("/work/recovered"), binary);
    const excluded = await shell.exec("tar -xOf owned.tar --exclude=other --strip-components=1");
    assert.equal(excluded.exitCode, 0, excluded.stderr);
    assert.deepEqual(excluded.stdoutBytes, binary);
    assert.equal((await shell.exec("tar -xOf owned.tar missing")).exitCode, 2);
    assert.equal((await shell.exec("tar -xOf -", { stdin: archive(member("../escape", binary)) })).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("stdout extraction uses byte output authority and keeps archive limits", async () => {
  const { fs, shell } = await fixture();
  await shell.dispose();
  const bytes = archive(member("file", binary));
  const result = await direct(["-xOf", "-"], fs, { stdin: source(bytes, 29) }, { limits: { maxTextBytes: 1 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(new Uint8Array(result.stdoutBytes), binary);
  const limited = await direct(["-xOf", "-"], fs, { stdin: source(bytes) }, { limits: { maxEntryBytes: 32 } });
  assert.equal(limited.exitCode, 2);
  assert.equal(limited.stdoutBytes.length, 0);
  const closed = gate();
  const reason = new Error("output rejected");
  let reported: unknown;
  const failing = await direct(["-xOf", "-"], fs, {
    stdin: { async *[Symbol.asyncIterator]() { try { yield bytes; } finally { closed.resolve(); } } },
    stdout: { write() { throw reason; } },
    onInternalError(error) { reported = error; },
  });
  assert.equal(failing.exitCode, 2);
  assert.equal(failing.stderr, "tar: internal error\n");
  assert.equal(reported, reason);
  await closed.promise;
});

test("creation admits sorting, dereference and cache exclusion on regular operands", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/file", binary);
    for (const option of ["--sort=name", "--sort none", "--dereference", "-h", "--exclude-caches"]) {
      const result = await shell.exec(`tar -cf archive ${option} file`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await shell.exec("tar -tf archive")).stdout, "file\n");
    }
    assert.equal((await shell.exec("tar -cf archive --sort=invalid file")).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("name sorting orders directory children while preserving operand order", async () => {
  const { fs } = await fixture();
  await fs.mkdir("/work/dir");
  for (const name of ["z", "a", "B"]) await fs.writeFile(`/work/dir/${name}`, binary);
  const { shell } = await fixture({}, wrapped(fs, {
    readdir: async (path, options) => (await fs.readdir(path, options)).sort((a, b) => b.name.localeCompare(a.name)),
  }));
  try {
    const result = await shell.exec("tar -cf archive --sort=name dir/z dir");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await shell.exec("tar -tf archive")).stdout, "dir/z\ndir/\ndir/B\ndir/a\ndir/z\n");
  } finally { await shell.dispose(); }
});

test("dereference archives referent content and directories and rejects cycles and output aliases", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/dir");
    await fs.writeFile("/work/dir/file", binary);
    await fs.symlink!("dir", "/work/link");
    const created = await shell.exec("tar -cf archive --dereference link");
    assert.equal(created.exitCode, 0, created.stderr);
    assert.equal((await shell.exec("tar -tf archive")).stdout, "link/\nlink/file\n");
    assert.equal((await shell.exec("tar -xf archive -C /out")).exitCode, 0);
    assert.deepEqual(await fs.readFile("/out/link/file"), binary);
    await fs.symlink!("..", "/work/dir/cycle");
    assert.equal((await shell.exec("tar -cf failed --dereference dir")).exitCode, 2);
    await assert.rejects(fs.stat("/work/failed"));
    await fs.symlink!("archive", "/work/output-link");
    const before = await fs.readFile("/work/archive");
    assert.equal((await shell.exec("tar -cf archive -h output-link")).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/archive"), before);
  } finally { await shell.dispose(); }
});

test("cache exclusion retains tagged directories and tag files but omits their other contents", async () => {
  const { fs, shell } = await fixture();
  try {
    for (const name of ["cache", "ordinary"]) {
      await fs.mkdir(`/work/${name}`);
      await fs.writeFile(`/work/${name}/file`, binary);
      await fs.writeFile(`/work/${name}/CACHEDIR.TAG`, Buffer.from(name === "cache"
        ? "Signature: 8a477f597d28d172789f06886806bc55\n# cache\n" : "invalid tag"));
    }
    const created = await shell.exec("tar -cf archive --sort=name --exclude-caches cache ordinary");
    assert.equal(created.exitCode, 0, created.stderr);
    assert.equal((await shell.exec("tar -tf archive")).stdout, "cache/\ncache/CACHEDIR.TAG\nordinary/\nordinary/CACHEDIR.TAG\nordinary/file\n");
  } finally { await shell.dispose(); }
});

test("tar reads exclusion files and selects wildcard archive members", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/archive.tar", archive(member("dir/a.txt", binary), member("dir/b.bin", binary), member("other/dir/c.txt", binary)));
    await fs.writeFile("/work/exclude", Buffer.from("*.bin\nother\n"));
    for (const flags of ["--exclude-from=exclude", "--exclude-from exclude", "-X exclude", "-Xexclude"]) {
      const result = await shell.exec(`tar ${flags} -tf archive.tar`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "dir/a.txt\n");
    }
    const listed = await shell.exec("tar --wildcards -tf archive.tar 'dir/*.txt'");
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(listed.stdout, "dir/a.txt\n");
    const extracted = await shell.exec("tar --wildcards -xf archive.tar -C /out 'dir/?.txt'");
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(await fs.readFile("/out/dir/a.txt"), binary);
    await assert.rejects(fs.stat("/out/dir/b.bin"));
    assert.equal((await shell.exec("tar --wildcards --no-wildcards -tf archive.tar 'dir/*.txt'")).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("tar occurrence selects the requested repeated member for listing and extraction", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/work/archive.tar", archive(member("a", Buffer.from("first")), member("b", binary), member("a", Buffer.from("second"))));
    for (const flag of ["--occurrence", "--occurrence=1", "--occurrence=2"]) {
      const result = await shell.exec(`tar ${flag} -tf archive.tar a`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "a\n");
    }
    const extracted = await shell.exec("tar --occurrence=1 -xf archive.tar -C /out a");
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.equal(Buffer.from(await fs.readFile("/out/a")).toString(), "first");
    assert.equal((await shell.exec("tar --occurrence=2 -xf archive.tar -C /out a")).exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile("/out/a")).toString(), "second");
    for (const flags of ["--occurrence=0 a", "--occurrence=-1 a", "--occurrence=1.5 a", "--occurrence=3 a", "--occurrence=1"]) {
      assert.equal((await shell.exec(`tar -tf archive.tar ${flags}`)).exitCode, 2, flags);
    }
  } finally { await shell.dispose(); }
});

test("tar exclusion files enforce input bounds and stdin ownership before archive effects", async () => {
  const { fs, shell } = await fixture({ limits: { maxFilesFromBytes: 8 } });
  try {
    await fs.writeFile("/work/file", binary);
    await fs.writeFile("/work/exclude", Buffer.from("file\n"));
    assert.equal((await shell.exec("tar -cf archive -X exclude file")).exitCode, 0);
    assert.equal((await shell.exec("tar -tf archive")).stdout, "");
    assert.equal((await shell.exec("tar -cf archive -X - file", { stdin: "file\n" })).exitCode, 0);
    for (const command of ["tar -cf new -X missing file", "tar -cf new -X exclude -X exclude file", "tar -tf - -X -", "tar -cf new --occurrence file"]) {
      assert.equal((await shell.exec(command, { stdin: "file\n" })).exitCode, 2, command);
      await assert.rejects(fs.stat("/work/new"));
    }
  } finally { await shell.dispose(); }
});

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

for (const policy of ["--keep-old-files", "-k", "--skip-old-files", "--overwrite"]) {
  test(`extraction policy ${policy} admits new files and handles existing files`, async () => {
    const { fs, shell } = await fixture();
    try {
      await fs.writeFile("/out/existing", Buffer.from("old"));
      await fs.utimes!("/out/existing", 123000, 456000);
      await fs.writeFile("/work/archive", archive(member("existing", binary), member("new", binary)));
      const fresh = await shell.exec(`tar -xf archive -C /out ${policy} new`);
      assert.equal(fresh.exitCode, 0, fresh.stderr);
      await fs.rm("/out/new");
      const result = await shell.exec(`tar -xf archive -C /out ${policy}`);
      assert.equal(result.exitCode, policy === "--keep-old-files" || policy === "-k" ? 2 : 0, result.stderr);
      assert.deepEqual(await fs.readFile("/out/new"), binary);
      assert.deepEqual(await fs.readFile("/out/existing"), policy === "--overwrite" ? binary : new Uint8Array(Buffer.from("old")));
      if (policy !== "--overwrite") assert.equal((await fs.stat("/out/existing")).mtimeMs, 456000);
      if (policy === "--skip-old-files" || policy === "--overwrite") assert.equal(result.stderr, "");
      else assert.match(result.stderr, /existing.*[Ff]ile exists/u);
    } finally { await shell.dispose(); }
  });
}

for (const policy of ["--keep-old-files", "--skip-old-files"]) {
  test(`${policy} preserves existing symlinks and nonempty directories and merges directory members`, async () => {
    const { fs, shell } = await fixture();
    try {
      await fs.writeFile("/out/referent", Buffer.from("old"));
      await fs.symlink!("referent", "/out/link");
      await fs.mkdir("/out/dir");
      await fs.writeFile("/out/dir/child", binary);
      await fs.mkdir("/out/merge");
      const bytes = archive(member("link", binary), member("dir", binary), member("merge/", undefined, "5"), member("merge/new", binary));
      const result = await shell.exec(`tar -xf - -C /out ${policy}`, { stdin: bytes });
      assert.equal(result.exitCode, policy === "--keep-old-files" ? 2 : 0, result.stderr);
      assert.equal(await fs.readlink!("/out/link"), "referent");
      assert.equal(Buffer.from(await fs.readFile("/out/referent")).toString(), "old");
      assert.deepEqual(await fs.readFile("/out/dir/child"), binary);
      assert.deepEqual(await fs.readFile("/out/merge/new"), binary);
    } finally { await shell.dispose(); }
  });
}

test("the last extraction policy wins and duplicate members follow the selected policy", async () => {
  const { fs, shell } = await fixture();
  try {
    const bytes = archive(member("file", Buffer.from("first")), member("file", Buffer.from("last")));
    const skipped = await shell.exec("tar -xf - -C /out --overwrite --skip-old-files", { stdin: bytes });
    assert.equal(skipped.exitCode, 0, skipped.stderr);
    assert.equal(Buffer.from(await fs.readFile("/out/file")).toString(), "first");
    const overwritten = await shell.exec("tar -xf - -C /out --keep-old-files --overwrite", { stdin: bytes });
    assert.equal(overwritten.exitCode, 0, overwritten.stderr);
    assert.equal(Buffer.from(await fs.readFile("/out/file")).toString(), "last");
  } finally { await shell.dispose(); }
});

for (const policy of ["--keep-old-files", "--skip-old-files", "--overwrite"]) {
  test(`${policy} preserves extraction safety checks`, async () => {
    const { fs, shell } = await fixture();
    try {
      await fs.symlink!("/work", "/out/link");
      for (const name of ["../escape", "link/file"]) {
        const result = await shell.exec(`tar -xf - -C /out ${policy}`, { stdin: archive(member(name, binary)) });
        assert.equal(result.exitCode, 2, result.stderr);
        assert.match(result.stderr, /unsafe/u);
      }
    } finally { await shell.dispose(); }
  });
}

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

for (const flags of ["-cf", "-cxf archive", "-cf archive -z --xz file", "-cf archive -Jj file", "-cf archive --format=zip file", "-cf archive --strip-components=1 file", "-tf - --strip-components=-1", "--create=yes", "cf archive", "-tf - --wildcards=yes", "cf archive file --exclude=foo"]) test(`unsupported/invalid flags are not ignored: ${flags}`, async () => {
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

test("tar supports --no-recursion, --transform in -c/-x, --strip-components with --show-transformed-names, and ./ member matching", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.mkdir("/work/dir", { recursive: true });
    await fs.writeFile("/work/dir/file", binary);
    const noRec = await shell.exec("tar --no-recursion -cf nr.tar dir && tar -tf nr.tar");
    assert.equal(noRec.exitCode, 0, noRec.stderr);
    assert.equal(noRec.stdout, "dir/\n");

    const trCreate = await shell.exec("tar -cf tr.tar --transform='s,^dir/,pkg/,' dir/file && tar -tf tr.tar");
    assert.equal(trCreate.exitCode, 0, trCreate.stderr);
    assert.equal(trCreate.stdout, "pkg/file\n");

    const stripShown = await shell.exec("tar -tf tr.tar --strip-components=1 --show-transformed-names");
    assert.equal(stripShown.exitCode, 0, stripShown.stderr);
    assert.equal(stripShown.stdout, "file\n");

    const dotArchive = await shell.exec("tar -cf dot.tar -C dir . && tar -tf dot.tar file");
    assert.equal(dotArchive.exitCode, 0, dotArchive.stderr);
    assert.equal(dotArchive.stdout, "./file\n");

    const plainArchive = await shell.exec("tar -cf plain.tar -C dir file && tar -tf plain.tar ./file");
    assert.equal(plainArchive.exitCode, 0, plainArchive.stderr);
    assert.equal(plainArchive.stdout, "file\n");

    await fs.mkdir("/out/tr", { recursive: true });
    const trExtract = await shell.exec("tar -xvf tr.tar -C /out/tr --strip-components=1 --show-transformed-names");
    assert.equal(trExtract.exitCode, 0, trExtract.stderr);
    assert.equal(trExtract.stdout, "file\n");
  } finally { await shell.dispose(); }
});
