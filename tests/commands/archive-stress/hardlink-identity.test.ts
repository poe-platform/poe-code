import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { archive, digest, member } from "./fixtures.js";
import { absent, fixture, source, success, tar } from "./helpers.js";

const payload = Buffer.from([0, 255, 65, 10]);
const changed = Buffer.from([66, 0, 128]);
const limits = { maxEntryBytes: 4, maxTotalBytes: 4, maxMembers: 3 };

function hardlink(name: string, target: string): Buffer {
  const header = member({ name, type: "2", link: target });
  header.write("0000777\0", 100, 8, "ascii");
  header.write("1", 156, 1, "ascii");
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  assert.equal(header.length, 512);
  return header;
}

const chain = archive(member({ name: "a", data: payload }), hardlink("b", "a"), hardlink("c", "b"));

test("H01 plain/gzip backward hardlink chains preserve inode, nlink and write aliases", async context => {
  for (const gzip of [false, true]) {
    const fs = await fixture();
    const bytes = gzip ? gzipSync(chain) : chain;
    success(await tar(fs, [gzip ? "-xzf" : "-xf", "-", "-C", "/output"], { stdin: source(bytes) }, { limits }));
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["a", "b", "c"]);
    const original = await fs.stat("/output/a");
    assert.ok(original.identityScope);
    assert.ok(Number.isSafeInteger(original.dev) && original.dev! >= 0);
    assert.ok(Number.isSafeInteger(original.ino) && original.ino! >= 0);
    for (const phase of ["initial", "write", "append"] as const) {
      if (phase === "write") await fs.writeFile("/output/b", changed);
      if (phase === "append") await fs.appendFile("/output/a", payload);
      for (const name of ["a", "b", "c"]) {
        const stat = await fs.lstat(`/output/${name}`);
        assert.equal(stat.type, "file");
        assert.equal(stat.nlink, 3);
        assert.equal(stat.identityScope, original.identityScope);
        assert.equal(stat.dev, original.dev);
        assert.equal(stat.ino, original.ino);
        assert.equal(stat.mode & 0o777, 0o640);
        assert.deepEqual(Buffer.from(await fs.readFile(`/output/${name}`)), phase === "initial" ? payload : phase === "write" ? changed : Buffer.concat([changed, payload]));
      }
    }
    context.diagnostic(JSON.stringify({ gzip, fixtureSha256: digest(bytes), limits, nlink: 3, sameIdentityAndSharedWrites: true }));
  }
});

test("H02 missing hardlink method or false capability explicitly rejects without copy fallback", async context => {
  for (const missingMethod of [true, false]) {
    const fs = await fixture();
    await fs.writeFile("/output/b", Buffer.from("keep"));
    let linkCalls = 0;
    const wrapped = new Proxy(fs, { get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, hardlinks: missingMethod };
      if (key === "link") return missingMethod ? undefined : async () => { linkCalls++; throw new Error("unsupported link must not be called"); };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const bytes = missingMethod ? chain : gzipSync(chain);
    const result = await tar(wrapped, [missingMethod ? "-xf" : "-xzf", "-", "-C", "/output"], { stdin: source(bytes) }, { limits });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /filesystem does not support hardlinks/);
    assert.equal(linkCalls, 0);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/a")), payload);
    assert.equal((await fs.stat("/output/a")).nlink, 1);
    assert.equal(Buffer.from(await fs.readFile("/output/b")).toString(), "keep");
    await absent(fs, "/output/c");
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["a", "b"]);
    context.diagnostic(JSON.stringify({ missingMethod, linkCalls, fixtureSha256: digest(bytes), ...result }));
  }
});

test("H03 malicious hardlink target and destination vectors preserve outside VFS sentinels", async context => {
  for (const pivot of [false, true]) {
    const fs = await fixture();
    if (pivot) await fs.symlink!("/outside", "/output/pivot");
    const bytes = archive(member({ name: "a", data: payload }), hardlink(pivot ? "pivot/evil" : "evil", pivot ? "a" : "../outside/sentinel"));
    const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes) }, { limits });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, pivot ? /symlink ancestor/ : /unsafe parent component/);
    assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "must remain unchanged");
    assert.equal((await fs.stat("/outside/sentinel")).nlink, 1);
    assert.deepEqual((await fs.readdir("/outside")).map(entry => entry.name), ["sentinel"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/a")), payload);
    assert.equal((await fs.stat("/output/a")).nlink, 1);
    await absent(fs, "/output/evil");
    await absent(fs, "/outside/evil");
    if (pivot) assert.equal(await fs.readlink!("/output/pivot"), "/outside");
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), pivot ? ["a", "pivot"] : ["a"]);
    context.diagnostic(JSON.stringify({ pivot, fixtureSha256: digest(bytes), ...result }));
  }
});
