import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

function fields(bytes, start, length) {
  const values = new Map();
  for (let offset = start; offset < start + length;) {
    const id = bytes.readUInt16LE(offset), size = bytes.readUInt16LE(offset + 2);
    assert.ok(offset + 4 + size <= start + length);
    assert.equal(values.has(id), false);
    values.set(id, bytes.subarray(offset + 4, offset + 4 + size));
    offset += 4 + size;
  }
  return values;
}
function entries(input) {
  const bytes = Buffer.from(input), end = bytes.lastIndexOf(Buffer.from('PK\x05\x06'));
  assert.ok(end >= 0);
  const result = [];
  let central = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    const nameSize = bytes.readUInt16LE(central + 28), extraSize = bytes.readUInt16LE(central + 30);
    const centralFields = fields(bytes, central + 46 + nameSize, extraSize);
    let local = bytes.readUInt32LE(central + 42);
    if (local === 0xffffffff) {
      const position = 8 * Number(bytes.readUInt32LE(central + 24) === 0xffffffff)
        + 8 * Number(bytes.readUInt32LE(central + 20) === 0xffffffff);
      local = Number(centralFields.get(1).readBigUInt64LE(position));
    }
    const localStart = local + 30 + bytes.readUInt16LE(local + 26);
    const localSize = bytes.readUInt16LE(local + 28);
    result.push({name: bytes.toString('utf8', central + 46, central + 46 + nameSize),
      local: fields(bytes, localStart, localSize), central: centralFields});
    central += 46 + nameSize + extraSize + bytes.readUInt16LE(central + 32);
  }
  return result;
}

for (const runtime of ["TypeScript", "Rust"]) for (const [options, stripped] of [
  ["-X", true], ["-X-", false], ["-X -X-", false], ["-X- -X", true], ["-qX-", false], ["-X -fz", true],
]) test(`${runtime} zip extra controls ${options}`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const fs = createMemoryFileSystem();
  const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
    : new RustWasmBash({fs, cwd: "/", forceNative: true});
  try {
    for (const name of ["keep", "fold"]) {
      await fs.writeFile(`/${name}`, Buffer.from(name));
      await fs.utimes(`/${name}`, 1730619001000, 1730619001000);
    }
    const initial = await shell.exec("zip -q sample.zip keep");
    assert.equal(initial.exitCode, 0, initial.stderr);
    const unchanged = entries(await fs.readFile("/sample.zip"))[0];
    const result = await shell.exec(`zip -q ${options} sample.zip fold`);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    const [keep, fold] = entries(await fs.readFile("/sample.zip"));
    if (options.includes("-fz")) {keep.local.delete(1); keep.central.delete(1);}
    assert.deepEqual(keep, unchanged);
    assert.equal(fold.name, "fold");
    for (const record of [fold.local, fold.central]) {
      if (stripped) assert.deepEqual([...record.keys()], options.includes("-fz") ? [1] : []);
      else {
        const timestamp = record.get(0x5455);
        assert.ok(timestamp);
        assert.equal(timestamp[0] & 1, 1);
        assert.equal(timestamp.readInt32LE(1), 1730619001);
      }
    }
    const payload = await shell.exec("unzip -p sample.zip fold");
    assert.equal(payload.exitCode, 0, payload.stderr);
    assert.equal(payload.stdout, "fold");
    if (runtime === "Rust") assert.equal(shell._companion, null);
  } finally {await shell.dispose();}
});
