import assert from "node:assert/strict";
import test from "node:test";
import { archive, direct, fixture, member, wrapped } from "./helpers.js";

for (const mode of ["--append", "-r", "rf", "--update", "-u", "--compare", "--diff", "-d", "--delete", "--catenate", "--concatenate", "-A"]) {
  test(`tar ${mode} executes archive operation`, async () => {
    const { fs, shell } = await fixture();
    await fs.writeFile("/work/input", Buffer.from("old"));
    await fs.utimes!("/work/input", 100000, 100000);
    assert.equal((await shell.exec("tar --format=ustar -cf archive.tar input")).exitCode, 0);
    await fs.writeFile("/work/second", Buffer.from("second"));
    assert.equal((await shell.exec("tar -cf second.tar second")).exitCode, 0);
    const concatenate = ["--catenate", "--concatenate", "-A"].includes(mode);
    const result = await shell.exec(`tar ${mode === "rf" ? "rf archive.tar" : `${mode} -f archive.tar`} ${concatenate ? "second.tar" : "input"}`);
    assert.equal(result.exitCode, 0, result.stderr);
    const list = await shell.exec("tar -tf archive.tar");
    assert.equal(list.exitCode, 0, list.stderr);
    assert.equal(list.stdout, mode === "--delete" ? "" : concatenate ? "input\nsecond\n" : ["--append", "-r", "rf"].includes(mode) ? "input\ninput\n" : "input\n");
    assert.equal((await shell.exec("tar -xf archive.tar -C /out")).exitCode, 0);
    if (mode !== "--delete") assert.equal(Buffer.from(await fs.readFile("/out/input")).toString(), "old");
    if (concatenate) assert.equal(Buffer.from(await fs.readFile("/out/second")).toString(), "second");
  });
}

test("tar update appends newer and absent members and retains older versions", async () => {
  const { fs, shell } = await fixture();
  await fs.writeFile("/work/input", Buffer.from("old"));
  await fs.utimes!("/work/input", 100000, 100000);
  await shell.exec("tar -cf archive.tar input");
  await fs.writeFile("/work/input", Buffer.from("new"));
  await fs.utimes!("/work/input", 101000, 101000);
  await fs.writeFile("/work/absent", Buffer.from("added"));
  const result = await shell.exec("tar -uf archive.tar input absent");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await shell.exec("tar -tf archive.tar")).stdout, "input\ninput\nabsent\n");
  assert.equal((await shell.exec("tar -xf archive.tar -C /out")).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/out/input")).toString(), "new");
  assert.equal(Buffer.from(await fs.readFile("/out/absent")).toString(), "added");
});

test("tar update with no newer files leaves archive identity and bytes unchanged", async () => {
  const { fs, shell } = await fixture();
  await fs.writeFile("/work/input", Buffer.from("old"));
  await shell.exec("tar -cf archive.tar input");
  const before = await fs.stat("/work/archive.tar");
  const bytes = await fs.readFile("/work/archive.tar");
  assert.equal((await shell.exec("tar -uf archive.tar input")).exitCode, 0);
  assert.equal((await fs.stat("/work/archive.tar")).ino, before.ino);
  assert.deepEqual(await fs.readFile("/work/archive.tar"), bytes);
});

for (const command of ["tar -rf archive.tar missing", "tar --delete -f archive.tar missing", "tar -Af archive.tar archive.tar", "tar -rf archive.tar archive.tar", "tar -rzf archive.tar input"]) {
  test(`tar failed preparation preserves original archive: ${command}`, async () => {
    const { fs, shell } = await fixture();
    await fs.writeFile("/work/input", Buffer.from("old"));
    await shell.exec("tar -cf archive.tar input");
    const before = await fs.readFile("/work/archive.tar");
    assert.equal((await shell.exec(command)).exitCode, 2);
    assert.deepEqual(await fs.readFile("/work/archive.tar"), before);
  });
}

test("tar mutation preserves untouched USTAR bytes and rejects corrupt concatenation sources", async () => {
  const { fs, shell } = await fixture();
  const original = member("keep", Buffer.from([0, 255, 10]));
  await fs.writeFile("/work/archive.tar", archive(original, member("remove", Buffer.from("gone"))));
  assert.equal((await shell.exec("tar --delete -f archive.tar remove")).exitCode, 0);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/archive.tar")), archive(original));
  await fs.writeFile("/work/broken.tar", Buffer.from("invalid"));
  assert.equal((await shell.exec("tar -Af archive.tar broken.tar")).exitCode, 2);
  assert.deepEqual(Buffer.from(await fs.readFile("/work/archive.tar")), archive(original));
});

test("tar compare detects mode and timestamp changes and refuses unknown metadata", async () => {
  const { fs, shell } = await fixture();
  await fs.writeFile("/work/input", Buffer.from("old"));
  await shell.exec("tar -cf archive.tar input");
  await fs.chmod!("/work/input", 0o700);
  await fs.utimes!("/work/input", 0, 0);
  const result = await shell.exec("tar -df archive.tar");
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /Mode differs/);
  assert.match(result.stdout, /Mod time differs/);
  const unknown = wrapped(fs, { async lstat(path, options) {
    const stat = await fs.lstat(path, options);
    const { uid: ignoredUid, gid: ignoredGid, ...rest } = stat;
    return rest;
  } });
  assert.equal((await direct(["-df", "archive.tar"], unknown)).exitCode, 2);
});

test("tar compare reports content, metadata and missing-file differences without mutation", async () => {
  const { fs, shell } = await fixture();
  await fs.writeFile("/work/input", Buffer.from("old"));
  await shell.exec("tar -cf archive.tar input");
  const before = await fs.readFile("/work/archive.tar");
  await fs.writeFile("/work/input", Buffer.from("NEW"));
  const result = await shell.exec("tar -df archive.tar");
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stdout, /Contents differ/);
  await fs.rm("/work/input");
  assert.equal((await shell.exec("tar --diff -f archive.tar")).exitCode, 1);
  assert.deepEqual(await fs.readFile("/work/archive.tar"), before);
});

test("tar delete selects duplicate occurrences and leaves unselected members intact", async () => {
  const { fs, shell } = await fixture();
  await fs.writeFile("/work/input", Buffer.from("old"));
  await shell.exec("tar -cf archive.tar input");
  await fs.writeFile("/work/input", Buffer.from("new"));
  await shell.exec("tar -rf archive.tar input");
  const result = await shell.exec("tar --delete --occurrence=1 -f archive.tar input");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await shell.exec("tar -tf archive.tar")).stdout, "input\n");
  assert.equal((await shell.exec("tar -xf archive.tar -C /out")).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/out/input")).toString(), "new");
});
