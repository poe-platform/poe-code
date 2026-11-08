import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/index.js";

function fixture(name: string, payload: Uint8Array, options: { deflate?: boolean; symlink?: boolean; corrupt?: boolean } = {}): Uint8Array {
  let checksum = 0xffffffff;
  for (const byte of payload) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
  }
  checksum = (checksum ^ 0xffffffff) >>> 0;
  const encoded = Buffer.from(name);
  const data = options.deflate ? deflateRawSync(payload) : Buffer.from(payload);
  const local = Buffer.alloc(30 + encoded.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(options.deflate ? 8 : 0, 8);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(options.corrupt ? (checksum ^ 1) >>> 0 : checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(encoded.length, 26);
  encoded.copy(local, 30);
  const central = Buffer.alloc(46 + encoded.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x314, 4);
  local.copy(central, 6, 4, 28);
  central.writeUInt32LE(((options.symlink ? 0o120777 : 0o100644) * 65536) >>> 0, 38);
  encoded.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, end]);
}

for (const name of ["../escape", "/escape", "directory/../escape"]) {
  test(`unzip rejects traversal spelling ${name} without namespace effects`, async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      await fs.mkdir("/out");
      await fs.writeFile("/input.zip", fixture(name, new Uint8Array([65])));
      const result = await shell.exec("unzip -o -d /out /input.zip");
      assert.notEqual(result.exitCode, 0);
      assert.notEqual(result.exitCode, 127);
      assert.deepEqual(await fs.readdir("/out"), []);
      await assert.rejects(fs.lstat("/escape"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  });
}

for (const rootLink of [false, true]) {
  test(`unzip rejects ${rootLink ? "root" : "member-parent"} symlink escape`, async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      await fs.mkdir("/outside");
      if (rootLink) await fs.symlink!("/outside", "/out");
      else {
        await fs.mkdir("/out");
        await fs.symlink!("/outside", "/out/parent");
      }
      await fs.writeFile("/input.zip", fixture(rootLink ? "escape" : "parent/escape", new Uint8Array([65])));
      const result = await shell.exec("unzip -o -d /out /input.zip");
      assert.notEqual(result.exitCode, 0);
      assert.notEqual(result.exitCode, 127);
      assert.deepEqual(await fs.readdir("/outside"), []);
    } finally { await shell.dispose(); }
  });
}

test("unzip refuses an escaping archive symlink target before creating it", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await fs.mkdir("/out");
    await fs.writeFile("/input.zip", fixture("link", Buffer.from("../outside"), { symlink: true }));
    const result = await shell.exec("unzip -o -d /out /input.zip");
    assert.notEqual(result.exitCode, 0);
    assert.notEqual(result.exitCode, 127);
    await assert.rejects(fs.lstat("/out/link"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

test("unzip charges expanded bytes before replacing a destination and recovers after the limit", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, limits: { maxOutputBytes: 512 } }).use(agentCommands());
  try {
    await fs.mkdir("/out");
    await fs.writeFile("/out/data", Buffer.from("original"));
    await fs.writeFile("/input.zip", fixture("data", new Uint8Array(128 * 1024).fill(65), { deflate: true }));
    await assert.rejects(shell.exec("unzip -o -d /out /input.zip"), /maxOutputBytes/u);
    assert.deepEqual(await fs.readFile("/out/data"), new TextEncoder().encode("original"));
    const recovered = await shell.exec("printf ok");
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.equal(recovered.stdout, "ok");
  } finally { await shell.dispose(); }
});

test("unzip validates CRC before replacing an existing file", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await fs.mkdir("/out");
    await fs.writeFile("/out/data", Buffer.from("original"));
    await fs.writeFile("/input.zip", fixture("data", Buffer.from("corrupt"), { corrupt: true }));
    const result = await shell.exec("unzip -o -d /out /input.zip");
    assert.notEqual(result.exitCode, 0);
    assert.notEqual(result.exitCode, 127);
    assert.deepEqual(await fs.readFile("/out/data"), new TextEncoder().encode("original"));
  } finally { await shell.dispose(); }
});
