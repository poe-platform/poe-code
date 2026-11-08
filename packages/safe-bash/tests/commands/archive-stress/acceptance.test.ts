import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { setTimeout as delay } from "node:timers/promises";
import { createBytePipe } from "../../../src/contracts/index.js";
import { Shell } from "../../../src/shell/index.js";
import { byteCommands } from "../../../src/commands/bytes/index.js";
import { archive, digest, longName, member, pattern, pax, paxSample } from "./fixtures.js";
import { absent, archiveCommands, deadline, fixture, gate, source, success, tar } from "./helpers.js";

test("A01 named create is a snapshot; selected extraction truncates only its destination", { timeout: 8000 }, async () => {
  const fs = await fixture();
  const original = pattern(1037);
  await fs.writeFile("/input/selected", original);
  await fs.writeFile("/input/unselected", pattern(19));
  success(await tar(fs, ["-cf", "snapshot.tar", "unselected", "selected"]));
  await fs.writeFile("/input/selected", pattern(53, 99));
  await fs.writeFile("/output/selected", pattern(4097));
  await fs.writeFile("/output/keep", pattern(23));
  const listed = await tar(fs, ["-tf", "snapshot.tar"]);
  success(listed);
  assert.equal(listed.stdout.toString(), "unselected\nselected\n");
  success(await tar(fs, ["-xf", "snapshot.tar", "-C", "/output", "selected"]));
  assert.deepEqual(Buffer.from(await fs.readFile("/output/selected")), original);
  assert.deepEqual(Buffer.from(await fs.readFile("/output/keep")), pattern(23));
  assert.deepEqual(Buffer.from(await fs.readFile("/input/selected")), pattern(53, 99));
  await absent(fs, "/output/unselected");
  assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["keep", "selected"]);
});

test("A02 strict USTAR output independently validates prefix, checksum, padding and payload", { timeout: 8000 }, async () => {
  const fs = await fixture();
  const prefix = "folder".repeat(20);
  const leaf = "leaf".repeat(21);
  const payload = pattern(1029, 41);
  await fs.mkdir(`/input/${prefix}`);
  await fs.writeFile(`/input/${prefix}/${leaf}`, payload);
  const result = await tar(fs, ["--format=ustar", "-cf", "-", `${prefix}/${leaf}`]);
  success(result);
  const bytes = result.stdout;
  const field = (offset: number, size: number) => bytes.subarray(offset, offset + size).toString("utf8").replace(/\0.*$/su, "");
  assert.equal(field(0, 100), leaf);
  assert.equal(field(345, 155), prefix);
  assert.equal(field(257, 6), "ustar");
  assert.equal(Number.parseInt(field(124, 12), 8), payload.length);
  const checksum = bytes.subarray(0, 512).reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  assert.equal(Number.parseInt(field(148, 8), 8), checksum);
  assert.deepEqual(bytes.subarray(512, 512 + payload.length), payload);
  assert.equal(bytes.length % 512, 0);
  assert.ok(bytes.length >= 512 + 1536 + 1024);
  assert.ok(bytes.subarray(512 + payload.length).every(byte => byte === 0));
});

test("A03 excluding a locally overridden member consumes its PAX state before global replacement", async () => {
  const fs = await fixture();
  const bytes = archive(
    member({ name: "global", type: "g", data: pax(["mtime", "1700123400"]) }),
    member({ name: "local", type: "x", data: pax(["mtime", "1700123401.125"]) }),
    member({ name: "first", data: pattern(7) }),
    member({ name: "second", data: pattern(9) }),
    member({ name: "global-next", type: "g", data: pax(["mtime", "1700123402"]) }),
    member({ name: "third", data: pattern(11) }),
  );
  success(await tar(fs, ["-xf", "-", "-C", "/output", "--exclude=first"], { stdin: source(bytes, 73) }));
  for (const [name, mtime, size] of [["second", 1700123400000, 9], ["third", 1700123402000, 11]] as const) {
    assert.equal((await fs.stat(`/output/${name}`)).mtimeMs, mtime);
    assert.deepEqual(Buffer.from(await fs.readFile(`/output/${name}`)), pattern(size));
  }
  await absent(fs, "/output/first");
  assert.equal((await fs.readdir("/output")).length, 2);
});

test("A04 repeated PAX path keys use the last UTF-8 value only for the next member", async () => {
  const fs = await fixture();
  const bytes = archive(
    member({ name: "extension", type: "x", data: pax(["path", "discarded"], ["comment", "雪"], ["path", longName]) }),
    member({ name: "raw", data: pattern(67) }),
    member({ name: "next", data: pattern(29) }),
  );
  const result = await tar(fs, ["-tf", "-"], { stdin: source(bytes, 13) });
  success(result);
  assert.equal(result.stdout.toString(), `${longName}\nnext\n`);
  success(await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes, 41) }));
  assert.deepEqual(Buffer.from(await fs.readFile(`/output/${longName}`)), pattern(67));
  assert.deepEqual(Buffer.from(await fs.readFile("/output/next")), pattern(29));
  await absent(fs, "/output/raw");
  await absent(fs, "/output/discarded");
});

test("A05 selecting a PAX long path before stripping preserves unselected existing files", async () => {
  const fs = await fixture();
  const original = `bundle/deep/${longName}`;
  const bytes = archive(
    member({ name: "pax", type: "x", data: pax(["path", original]) }),
    member({ name: "short", data: pattern(733) }),
    member({ name: "bundle/ignored", data: pattern(13) }),
  );
  await fs.writeFile("/output/ignored", pattern(31));
  success(await tar(fs, ["-xf", "-", "-C", "/output", "--strip-components=2", original], { stdin: source(bytes, 509) }));
  assert.deepEqual(Buffer.from(await fs.readFile(`/output/${longName}`)), pattern(733));
  assert.deepEqual(Buffer.from(await fs.readFile("/output/ignored")), pattern(31));
  await absent(fs, "/output/short");
  await absent(fs, "/output/bundle");
});

test("A06 a traversal hidden in PAX path cannot be laundered by exclude plus strip", async () => {
  const fs = await fixture();
  const bytes = archive(
    member({ name: "extension", type: "x", data: pax(["path", "../outside/sentinel"]) }),
    member({ name: "innocent", data: pattern(61) }),
  );
  const result = await tar(fs, ["-xf", "-", "-C", "/output", "--exclude=*", "--strip-components=2"], { stdin: source(bytes) });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /path|travers|\.\./iu);
  assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "must remain unchanged");
  assert.deepEqual(await fs.readdir("/output"), []);
});

test("A07 escaping PAX linkpath overrides a harmless raw symlink target and must fail", async () => {
  const fs = await fixture();
  const bytes = archive(
    member({ name: "extension", type: "x", data: pax(["linkpath", "../../outside/sentinel"]) }),
    member({ name: "symbol", type: "2", link: "safe" }),
  );
  const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes, 127) });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /link|escap|outside|root/iu);
  await absent(fs, "/output/symbol");
  assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "must remain unchanged");
});

test("A08 safe forward long PAX link resolves only when its later file is published", async () => {
  const fs = await fixture();
  const bytes = archive(
    member({ name: "link-extension", type: "x", data: pax(["linkpath", longName]) }),
    member({ name: "symbol", type: "2", link: "wrong-raw-target" }),
    member({ name: "file-extension", type: "x", data: pax(["path", longName]) }),
    member({ name: "wrong-raw-name", data: pattern(817) }),
  );
  success(await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes, 89) }));
  assert.equal((await fs.lstat("/output/symbol")).type, "symlink");
  assert.equal(await fs.readlink!("/output/symbol"), longName);
  assert.deepEqual(Buffer.from(await fs.readFile("/output/symbol")), pattern(817));
  await absent(fs, "/output/wrong-raw-name");
  await absent(fs, "/output/wrong-raw-target");
});

test("A09 corrupt PAX extension checksum cannot rename or replace an existing destination", async () => {
  const fs = await fixture();
  await fs.writeFile("/output/protected", pattern(47));
  const extension = member({ name: "extension", type: "x", data: pax(["path", "protected"]) });
  extension[100] = extension[100]! ^ 1;
  const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(archive(extension, member({ name: "raw", data: pattern(93) })), 151) });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /checksum/iu);
  assert.deepEqual(Buffer.from(await fs.readFile("/output/protected")), pattern(47));
  await absent(fs, "/output/raw");
});

test("A10 truncation inside PAX UTF-8 records and extension padding has no file effects", async () => {
  const data = pax(["path", longName]);
  const extension = member({ name: "extension", type: "x", data });
  for (const cut of [512 + data.indexOf(Buffer.from("雪")) + 1, 512 + data.length - 1, extension.length - 1]) {
    const fs = await fixture();
    await fs.writeFile("/output/protected", pattern(47));
    const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(extension.subarray(0, cut), 97) });
    assert.notEqual(result.exitCode, 0, `cut ${cut}`);
    assert.match(result.stderr, /truncat/iu);
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name), ["protected"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/output/protected")), pattern(47));
  }
});

test("A11 concatenated gzip members split inside a PAX header decode as one virtual archive", async () => {
  const fs = await fixture();
  const bytes = paxSample();
  const compressed = Buffer.concat([gzipSync(bytes.subarray(0, 731)), gzipSync(bytes.subarray(731, 1741)), gzipSync(bytes.subarray(1741))]);
  success(await tar(fs, ["-xzf", "-", "-C", "/output"], { stdin: source(compressed, 23) }));
  assert.deepEqual(Buffer.from(await fs.readFile(`/output/${longName}`)), pattern(1031));
  assert.deepEqual(Buffer.from(await fs.readFile("/output/following")), pattern(17, 7));
  assert.equal((await fs.stat(`/output/${longName}`)).mtimeMs, 1700123401125);
});

test("A12 virtual recompression pipeline preserves several deterministic files under tiny pipes", { timeout: 10000 }, async () => {
  const fs = await fixture();
  for (const [name, size] of [["alpha", 131101], ["beta", 37], ["empty", 0]] as const) await fs.writeFile(`/input/${name}`, pattern(size));
  const shell = new Shell({ fs, cwd: "/input", limits: { pipeHighWaterMark: 31, maxOutputBytes: 1024 * 1024 } }).use(byteCommands()).use(archiveCommands({ limits: { chunkSize: 512 } }));
  try {
    const result = await deadline(shell.exec("tar -czf - alpha beta empty | gunzip | gzip | tar -xzf - -C /output", { signal: AbortSignal.timeout(5000) }), 6500);
    success(result);
    assert.equal(result.stdoutBytes.length, 0);
    for (const [name, size] of [["alpha", 131101], ["beta", 37], ["empty", 0]] as const) assert.deepEqual(Buffer.from(await fs.readFile(`/output/${name}`)), pattern(size));
    assert.deepEqual((await fs.readdir("/output")).map(entry => entry.name).sort(), ["alpha", "beta", "empty"]);
  } finally { await shell.dispose(); }
});

test("A13 blocked gzip output resumes losslessly without overlapping sink writes", { timeout: 10000 }, async () => {
  const fs = await fixture();
  const payload = pattern(196631, 987);
  await fs.writeFile("/input/data", payload);
  const entered = gate();
  const resume = gate();
  const controller = new AbortController();
  const chunks: Buffer[] = [];
  let writes = 0;
  let active = false;
  let finished = false;
  let collected = 0;
  const running = tar(fs, ["--format=ustar", "-czf", "-", "data"], { signal: controller.signal, stdout: { async write(chunk) {
    assert.equal(active, false, "sink writes must be awaited");
    active = true;
    try {
      writes++;
      if (writes === 1) { entered.resolve(); await resume.promise; }
      collected += chunk.length;
      assert.ok(collected < 1024 * 1024);
      chunks.push(Buffer.from(chunk));
    } finally { active = false; }
  } } }, { limits: { chunkSize: 512 } }).then(result => { finished = true; return result; });
  void running.catch(() => {});
  try {
    await deadline(entered.promise);
    await delay(25);
    assert.equal(writes, 1);
    assert.equal(finished, false);
    resume.resolve();
    success(await deadline(running, 5000));
    const decoded = gunzipSync(Buffer.concat(chunks), { maxOutputLength: 1024 * 1024 });
    assert.deepEqual(decoded.subarray(512, 512 + payload.length), payload);
    success(await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(decoded) }));
    assert.equal(digest(await fs.readFile("/output/data")), digest(payload));
  } finally {
    resume.resolve();
    controller.abort(new Error("acceptance cleanup"));
    await deadline(Promise.allSettled([running]));
  }
});

test("A14 cancellation settles both composed gzip commands while listing output is blocked", { timeout: 10000 }, async () => {
  const fs = await fixture();
  await fs.writeFile("/input/data", pattern(262177, 444));
  const controller = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 17, signal: controller.signal });
  const entered = gate();
  const release = gate();
  const reason = new Error("independent composed pipeline cancellation");
  const producer = tar(fs, ["-czf", "-", "data"], { signal: controller.signal, stdout: pipe.writable }, { limits: { chunkSize: 512 } }).then(async result => { await pipe.close(); return result; });
  const consumer = tar(fs, ["-tzf", "-"], { signal: controller.signal, stdin: pipe.readable, stdout: { async write() { entered.resolve(); await release.promise; } } });
  const settled = Promise.allSettled([producer, consumer]);
  try {
    await deadline(entered.promise);
    controller.abort(reason);
    const results = await deadline(settled);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.equal(result.reason, reason);
    }
    assert.deepEqual(await fs.readdir("/output"), []);
    assert.deepEqual(Buffer.from(await fs.readFile("/input/data")), pattern(262177, 444));
  } finally {
    release.resolve();
    controller.abort(reason);
    await pipe.abort(reason);
    await deadline(settled);
  }
});

test("A15 PAX-renamed member cannot write through an existing VFS symlink ancestor", async () => {
  const fs = await fixture();
  await fs.symlink!("../outside", "/output/pivot");
  const bytes = archive(
    member({ name: "extension", type: "x", data: pax(["path", "pivot/sentinel"]) }),
    member({ name: "innocent", data: pattern(93) }),
  );
  const result = await tar(fs, ["-xf", "-", "-C", "/output"], { stdin: source(bytes, 83) });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /symlink|symbolic/iu);
  assert.equal(await fs.readlink!("/output/pivot"), "../outside");
  assert.equal(Buffer.from(await fs.readFile("/outside/sentinel")).toString(), "must remain unchanged");
  await absent(fs, "/output/innocent");
});
