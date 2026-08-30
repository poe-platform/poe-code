import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile, readFile, symlink, link, lstat, readlink, chmod, utimes } from "node:fs/promises";
import { join } from "node:path";
import { archive, binary, fixture, member, withNative } from "./helpers.js";

for (const gzip of [false, true]) test(`pinned GNU cross-readability BOTH directions ${gzip ? "gzip" : "plain"}`, async () => {
  await withNative(async (temporary, run) => {
    await mkdir(join(temporary, "input"));
    await mkdir(join(temporary, "native-output"));
    const long = "long-" + "x".repeat(140);
    const names = ["binary", "empty", "unicode-雪", "line\nname", long];
    for (const name of names) await writeFile(join(temporary, "input", name), name === "empty" ? new Uint8Array() : binary);
    await chmod(join(temporary, "input/binary"), 0o640);
    await utimes(join(temporary, "input/binary"), 1_700_000_000, 1_700_000_010.125);
    await symlink(long, join(temporary, "input/symbol"));
    await link(join(temporary, "input/binary"), join(temporary, "input/hard"));
    run(["--format=pax", `-c${gzip ? "z" : ""}f`, "native.tar", "-C", "input", ...names, "symbol", "hard"]);
    const { fs, shell } = await fixture();
    try {
      await fs.writeFile("/work/native.tar", await readFile(join(temporary, "native.tar")));
      const listing = await shell.exec(`tar -t${gzip ? "z" : ""}f native.tar`);
      assert.equal(listing.exitCode, 0, listing.stderr);
      assert.match(listing.stdout, /unicode-雪\n/u);
      const extracted = await shell.exec(`tar -x${gzip ? "z" : ""}f native.tar -C /out`);
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      for (const name of names) assert.deepEqual(await fs.readFile(`/out/${name}`), name === "empty" ? new Uint8Array() : binary);
      assert.equal(await fs.readlink!("/out/symbol"), long);
      assert.equal((await fs.stat("/out/binary")).ino, (await fs.stat("/out/hard")).ino);
      assert.equal((await fs.stat("/out/binary")).mode & 0o777, 0o640);
      assert.equal((await fs.stat("/out/binary")).mtimeMs, 1_700_000_010_125);
      const created = await shell.exec(`tar -c${gzip ? "z" : ""}f virtual.tar -C /out .`);
      assert.equal(created.exitCode, 0, created.stderr);
      await writeFile(join(temporary, "virtual.tar"), await fs.readFile("/work/virtual.tar"));
      const nativeListing = run([`-t${gzip ? "z" : ""}f`, "virtual.tar"]).toString();
      assert.match(nativeListing, /\.\/binary\n/u);
      run([`-x${gzip ? "z" : ""}f`, "virtual.tar", "-C", "native-output"]);
      for (const name of names) assert.deepEqual(await readFile(join(temporary, "native-output", name)), name === "empty" ? Buffer.alloc(0) : Buffer.from(binary));
      assert.equal(await readlink(join(temporary, "native-output/symbol")), long);
      assert.equal((await lstat(join(temporary, "native-output/binary"))).ino, (await lstat(join(temporary, "native-output/hard"))).ino);
      assert.equal((await lstat(join(temporary, "native-output/binary"))).mode & 0o777, 0o640);
    } finally { await shell.dispose(); }
  });
});

test("pinned GNU legacy long-name and long-link records are read without data conversion", async () => {
  await withNative(async (temporary, run) => {
    await mkdir(join(temporary, "input"));
    const long = "x".repeat(150);
    await writeFile(join(temporary, "input", long), binary);
    await symlink(long, join(temporary, "input/symbol"));
    run(["--format=gnu", "-cf", "native.tar", "-C", "input", long, "symbol"]);
    const { fs, shell } = await fixture();
    try {
      const bytes = await readFile(join(temporary, "native.tar"));
      const result = await shell.exec("tar xf - -C /out", { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile(`/out/${long}`), binary);
      assert.equal(await fs.readlink!("/out/symbol"), long);
    } finally { await shell.dispose(); }
  });
});

test("native -C, files-from, excludes, selected strips agree on safe common fixtures", async () => {
  await withNative(async (temporary, run) => {
    await mkdir(join(temporary, "input")); await mkdir(join(temporary, "input/sub")); await mkdir(join(temporary, "output"));
    await writeFile(join(temporary, "input/first"), binary);
    await writeFile(join(temporary, "input/sub/keep.txt"), binary);
    await writeFile(join(temporary, "input/sub/drop.tmp"), binary);
    const list = "-Cinput\nfirst\nsub\n";
    await writeFile(join(temporary, "names"), list);
    run(["--format=ustar", "-cf", "native.tar", "--exclude=*.tmp", "-T", "names"]);
    const expected = run(["-tf", "native.tar"]).toString();
    assert.equal(expected, "first\nsub/\nsub/keep.txt\n");
    run(["-xf", "native.tar", "-C", "output", "--strip-components=1", "sub/keep.txt"]);
    const { fs, shell } = await fixture();
    try {
      await fs.mkdir("/work/input/sub", { recursive: true });
      for (const name of ["first", "sub/keep.txt", "sub/drop.tmp"]) await fs.writeFile(`/work/input/${name}`, binary);
      await fs.writeFile("/work/names", Buffer.from(list));
      const created = await shell.exec("tar --format=ustar -cf archive --exclude='*.tmp' -T names");
      assert.equal(created.exitCode, 0, created.stderr);
      assert.equal((await shell.exec("tar tf archive")).stdout, expected);
      const result = await shell.exec("tar xf archive -C /out --strip-components=1 sub/keep.txt");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await fs.readFile("/out/keep.txt"), new Uint8Array(await readFile(join(temporary, "output/keep.txt"))));
    } finally { await shell.dispose(); }
  });
});

test("pinned GNU rejects forward hardlinks but continues; virtual rejects fail-fast", async () => {
  await withNative(async (temporary, run) => {
    await mkdir(join(temporary, "output"));
    const bytes = archive(member("hard", new Uint8Array(), "1", "later"), member("later", binary));
    await writeFile(join(temporary, "forward.tar"), bytes);
    assert.throws(() => run(["-xf", "forward.tar", "-C", "output"]), error => typeof error === "object" && error !== null && "status" in error && error.status === 2);
    await assert.rejects(readFile(join(temporary, "output/hard")), { code: "ENOENT" });
    assert.deepEqual(await readFile(join(temporary, "output/later")), Buffer.from(binary));
    const { shell } = await fixture();
    try {
      const virtual = await shell.exec("tar xf - -C /out", { stdin: bytes });
      assert.equal(virtual.exitCode, 2);
      assert.match(virtual.stderr, /forward or unselected target/u);
    } finally { await shell.dispose(); }
  });
});
