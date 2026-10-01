import { expect, test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
const bytes = (value: string) => new TextEncoder().encode(value);

for (const layer of ["upper", "lower"] as const) {
  test(`conditional rewrite and removal preserve the ${layer} source contract`, async () => {
    const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
    await ({ upper, lower })[layer].writeFile("/file", bytes("before"));
    const fs = new OverlayFileSystem({ upper, lower });
    expect(fs.capabilities.atomicFileMutation).toBe(true);
    const parent = await fs.lstat("/");
    const expected = await fs.lstat("/file");
    await fs.writeFileConditional!("/file", bytes("after"), { parent, expected });
    expect(await fs.readFile("/file")).toEqual(bytes("after"));
    await expect(fs.removeFileConditional!("/file", { parent, expected })).rejects.toMatchObject({ code: "EAGAIN" });
    await fs.removeFileConditional!("/file", { parent, expected: await fs.lstat("/file") });
    await expect(fs.lstat("/file")).rejects.toMatchObject({ code: "ENOENT" });
    if (layer === "lower") expect(await lower.readFile("/file")).toEqual(bytes("before"));
  });
  test(`no-replace rename handles ${layer} files and destinations`, async () => {
    const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
    await ({ upper, lower })[layer].writeFile("/file", bytes("before"));
    await lower.writeFile("/occupied", bytes("keep"));
    const fs = new OverlayFileSystem({ upper, lower });
    expect(fs.capabilities.atomicRenameNoReplace).toBe(true);
    await expect(fs.rename("/file", "/occupied", { noReplace: true })).rejects.toMatchObject({ code: "EEXIST" });
    await fs.rename("/file", "/moved", { noReplace: true });
    expect(await fs.readFile("/moved")).toEqual(bytes("before"));
    await expect(fs.lstat("/file")).rejects.toMatchObject({ code: "ENOENT" });
  });
}

for (const layer of ["upper", "lower"] as const) {
  test(`conditional writes reject stale ${layer} entries and parents`, async () => {
    for (const swap of ["file", "parent"] as const) {
      const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
      const backend = ({ upper, lower })[layer];
      await backend.mkdir("/work");
      await backend.writeFile("/work/file", bytes("before"));
      const fs = new OverlayFileSystem({ upper, lower });
      const parent = await fs.lstat("/work"), expected = await fs.lstat("/work/file");
      if (swap === "parent") {
        await backend.rename("/work", "/old");
        await backend.mkdir("/work");
      }
      await backend.writeFile("/work/file", bytes("foreign"));
      await expect(fs.writeFileConditional("/work/file", bytes("after"), { parent, expected })).rejects.toMatchObject({ code: "EAGAIN" });
      expect(await backend.readFile("/work/file")).toEqual(bytes("foreign"));
    }
  });
}

test("conditional writes preserve upper identity, creation modes and bounded lower append", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.writeFile("/lower", bytes("abc"), { mode: 0o640 });
  const fs = new OverlayFileSystem({ upper, lower, maxBufferBytes: 5 });
  const parent = await fs.lstat("/");
  let expected = await fs.lstat("/lower");
  expected = await fs.writeFileConditional("/lower", bytes("de"), { parent, expected, append: true, mode: 0o777 });
  expect(expected.mode & 0o777).toBe(0o640);
  const handle = await fs.openReadFile("/lower");
  const rewritten = await fs.writeFileConditional("/lower", bytes("xyz"), { parent, expected });
  expect(rewritten.ino).toBe(expected.ino);
  expect(await handle.read(0, 5)).toEqual(bytes("xyz"));
  await handle.close();
  await expect(fs.writeFileConditional("/lower", bytes("abc"), { parent, expected: rewritten, append: true })).rejects.toMatchObject({ code: "EFBIG" });
  expect(await fs.readFile("/lower")).toEqual(bytes("xyz"));
  expect(await lower.readFile("/lower")).toEqual(bytes("abc"));
  const created = await fs.writeFileConditional("/new", bytes("new"), { parent, expected: null, mode: 0o600 });
  expect(created.mode & 0o777).toBe(0o600);
  await expect(fs.writeFileConditional("/new", bytes("replace"), { parent, expected: null })).rejects.toMatchObject({ code: "EFBIG" });
  await expect(fs.writeFileConditional("/new", bytes("oops"), { parent, expected: null })).rejects.toMatchObject({ code: "EAGAIN" });
});

test("confined conditional writes enforce retained roots and buffer limits", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.mkdir("/work");
  await lower.writeFile("/work/file", bytes("abc"));
  const fs = new OverlayFileSystem({ upper, lower, maxBufferBytes: 3 });
  const parent = await fs.lstat("/work"), expected = await fs.lstat("/work/file");
  const view = await fs.confineExtraction(["/work"]);
  await expect(view.writeFileConditional!("/work/file", bytes("abcd"), { parent, expected })).rejects.toMatchObject({ code: "EFBIG" });
  await expect(view.writeFileConditional!("/outside", bytes("x"), { parent, expected: null })).rejects.toMatchObject({ code: "EPERM" });
  await lower.rename("/work", "/old");
  await lower.mkdir("/work");
  await expect(view.writeFileConditional!("/work/file", bytes("x"), { parent, expected })).rejects.toMatchObject({ code: "EAGAIN" });
});

test("cancelled and customized backends cannot commit conditional mutations", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.writeFile("/file", bytes("before"));
  const fs = new OverlayFileSystem({ upper, lower });
  const parent = await fs.lstat("/"), expected = await fs.lstat("/file");
  const signal = AbortSignal.abort(new Error("cancelled"));
  await expect(fs.writeFileConditional("/file", bytes("x"), { parent, expected, signal })).rejects.toThrow("cancelled");
  await expect(fs.removeFileConditional("/file", { parent, expected, signal })).rejects.toThrow("cancelled");
  upper.writeFile = async () => {};
  await expect(fs.writeFileConditional("/file", bytes("x"), { parent, expected })).rejects.toMatchObject({ code: "ENOTSUP" });
  await expect(fs.rename("/file", "/moved", { noReplace: true })).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(await lower.readFile("/file")).toEqual(bytes("before"));
});

test("concurrent no-replace publishers leave one winner and retain the loser", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.writeFile("/one", bytes("one"));
  await lower.writeFile("/two", bytes("two"));
  const fs = new OverlayFileSystem({ upper, lower });
  const outcomes = await Promise.allSettled([fs.rename("/one", "/winner", { noReplace: true }), fs.rename("/two", "/winner", { noReplace: true })]);
  expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(await fs.readFile("/winner")).toEqual(bytes("one"));
  expect(await fs.readFile("/two")).toEqual(bytes("two"));
});

for (const kind of ["same path", "directory", "symlink"] as const) {
  test(`no-replace rename preserves a ${kind} destination`, async () => {
    const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
    await lower.writeFile("/source", bytes("source"));
    const destination = kind === "same path" ? "/source" : "/destination";
    if (kind === "directory") await lower.mkdir(destination);
    if (kind === "symlink") await lower.symlink("/missing", destination);
    const fs = new OverlayFileSystem({ upper, lower });
    await expect(fs.rename("/source", destination, { noReplace: true })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile("/source")).toEqual(bytes("source"));
  });
}

test("rename refuses lower changes made while materializing its source", async () => {
  const upper = new MemoryFileSystem(), lower = new MemoryFileSystem();
  await lower.writeFile("/source", bytes("before"));
  const fs = new OverlayFileSystem({ upper, lower });
  const move = fs.rename("/source", "/destination", { noReplace: true });
  const outcome = move.then(() => undefined, error => error);
  let copied = false;
  for (let turn = 0; turn < 1000 && !copied; turn++) {
    try { await upper.lstat("/source"); copied = true; }
    catch { await Promise.resolve(); }
  }
  expect(copied).toBe(true);
  await lower.writeFile("/source", bytes("foreign"));
  expect(await outcome).toMatchObject({ code: "EAGAIN" });
  expect(await lower.readFile("/source")).toEqual(bytes("foreign"));
  await expect(fs.lstat("/destination")).rejects.toMatchObject({ code: "ENOENT" });
});

test("confined writes own bytes and options before waiting for the overlay queue", async () => {
  const fs = new OverlayFileSystem({ upper: new MemoryFileSystem(), lower: new MemoryFileSystem() });
  const parent = await fs.lstat("/");
  const view = await fs.confineExtraction(["/"]);
  const data = bytes("safe");
  const options = { parent, expected: null, mode: 0o600 };
  const write = view.writeFileConditional!("/file", data, options);
  data.fill(0);
  options.mode = 0o777;
  const receipt = await write;
  expect(await fs.readFile("/file")).toEqual(bytes("safe"));
  expect(receipt.mode & 0o777).toBe(0o600);
});
