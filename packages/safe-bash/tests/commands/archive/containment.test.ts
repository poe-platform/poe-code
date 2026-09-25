import assert from "node:assert/strict";
import test from "node:test";
import { archive, direct, fixture, member, wrapped } from "./helpers.js";

test("tar refuses a parent symlink swap after lstat", async () => {
  const { fs, shell } = await fixture();
  await fs.mkdir("/out/sub");
  await fs.mkdir("/private");
  await fs.writeFile("/work/archive", archive(member("sub/file", Buffer.from("payload"))));
  let swapped = false;
  const raced = wrapped(fs, {
    async confineExtraction(roots, options) {
      return wrapped(await fs.confineExtraction!(roots, options), { lstat: raced.lstat });
    },
    async lstat(path, options) {
      const stat = await fs.lstat(path, options);
      if (path === "/out/sub" && !swapped) {
        swapped = true;
        await fs.rmdir!(path);
        await fs.symlink!("../private", path);
      }
      return stat;
    },
  });
  const result = await direct(["-xf", "/work/archive", "-C", "/out"], raced);
  assert.equal(swapped, true, result.stderr);
  assert.notEqual(result.exitCode, 0);
  await assert.rejects(fs.lstat("/private/file"), { code: "ENOENT" });
  await shell.dispose();
});

for (const [name, bytes, method] of [
  ["directory creation", archive(member("sub/dir", undefined, "5")), "mkdir"],
  ["symlink creation", archive(member("sub/link", undefined, "2", "file")), "symlink"],
  ["hardlink destination", archive(member("file", Buffer.from("payload")), member("sub/link", undefined, "1", "file")), "link"],
  ["file removal", archive(member("sub/file", Buffer.from("payload"))), "rm"],
  ["permissions", archive(member("sub/file", Buffer.from("payload"))), "chmod"],
  ["timestamps", archive(member("sub/file", Buffer.from("payload"))), "utimes"],
] as const) {
  test(`tar retains containment during ${name}`, async () => {
    const { fs, shell } = await fixture();
    await fs.mkdir("/out/sub");
    await fs.mkdir("/private");
    await fs.writeFile("/private/sentinel", Buffer.from("unchanged"));
    await fs.writeFile("/private/file", Buffer.from("private target"));
    await fs.chmod!("/private/file", 0o400);
    await fs.utimes!("/private/file", 1_000, 2_000);
    const privateStat = await fs.stat("/private/file");
    if (method === "rm") await fs.writeFile("/out/sub/file", Buffer.from("old"));
    await fs.writeFile("/work/archive", bytes);
    let swapped = false;
    const race = (target: typeof fs) => new Proxy(target, { get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (property !== method) return value.bind(target);
      return async (...args: unknown[]) => {
        const path = args[property === "link" || property === "symlink" ? 1 : 0] as string;
        if (path.startsWith("/out/sub/") && !swapped) {
          swapped = true;
          await fs.rename("/out/sub", "/parked");
          await fs.symlink!("../private", "/out/sub");
        }
        return Reflect.apply(value, target, args);
      };
    } });
    const raced = wrapped(fs, { async confineExtraction(roots, options) { return race(await fs.confineExtraction!(roots, options)); } });
    const result = await direct(["-xf", "/work/archive", "-C", "/out"], raced);
    assert.equal(swapped, true, result.stderr);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual((await fs.readdir("/private")).map(entry => entry.name).sort(), ["file", "sentinel"]);
    assert.equal(Buffer.from(await fs.readFile("/private/file")).toString(), "private target");
    const after = await fs.stat("/private/file");
    assert.equal(after.mode, privateStat.mode);
    assert.equal(after.mtimeMs, privateStat.mtimeMs);
    assert.equal(Buffer.from(await fs.readFile("/private/sentinel")).toString(), "unchanged");
    await shell.dispose();
  });
}

test("tar refuses backends without atomic containment but still supports listing and stdout extraction", async () => {
  const { fs, shell } = await fixture();
  await fs.writeFile("/work/archive", archive(member("file", Buffer.from("payload"))));
  const unsupported = new Proxy(fs, { get(target, property) {
    if (property === "confineExtraction") return undefined;
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await direct(["-xf", "archive", "-C", "/out"], unsupported);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /race-safe archive extraction/u);
  assert.deepEqual(await fs.readdir("/out"), []);
  assert.equal((await direct(["-tf", "archive"], unsupported)).exitCode, 0);
  const output = await direct(["-xOf", "archive"], unsupported);
  assert.equal(output.exitCode, 0);
  assert.equal(output.stdout, "payload");
  await shell.dispose();
});

test("tar's writeFile/appendFile fallback retains containment", async () => {
  const { fs, shell } = await fixture();
  await fs.mkdir("/out/sub");
  await fs.mkdir("/private");
  await fs.writeFile("/work/archive", archive(member("sub/file", Buffer.from("payload"))));
  let swapped = false;
  const raced = wrapped(fs, {
    async confineExtraction(roots, options) {
      const confined = await fs.confineExtraction!(roots, options);
      return wrapped(confined, {
        capabilities: { ...confined.capabilities, streamingWrite: false },
        async appendFile(path, bytes, settings) {
          swapped = true;
          await fs.rename("/out/sub", "/parked");
          await fs.symlink!("../private", "/out/sub");
          return confined.appendFile(path, bytes, settings);
        },
      });
    },
  });
  const result = await direct(["-xf", "/work/archive", "-C", "/out"], raced);
  assert.equal(swapped, true, result.stderr);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readdir("/private"), []);
  assert.equal((await fs.readFile("/parked/file")).length, 0);
  await shell.dispose();
});
