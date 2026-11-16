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

for (const runtime of ["TypeScript", "Rust"]) for (const [filters, names] of [
  ["-i 'folder/*' -x 'folder/'", ["data", "binary"]],
  ["-i 'folder/data'", []],
  ["-x 'folder/data'", ["data", "binary"]],
]) test(`${runtime} zip junks filter paths before matching source names: ${filters}`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/folder");
  await fs.writeFile("/folder/data", Buffer.from("payload"));
  await fs.writeFile("/binary", Buffer.from("binary"));
  const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
    : new RustWasmBash({fs, cwd: "/", forceNative: true});
  try {
    const result = await shell.exec(`zip -qrj output.zip folder binary ${filters}`);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(entries(await fs.readFile("/output.zip")).map(entry => entry.name), names);
    assert.equal(Buffer.from(await fs.readFile("/folder/data")).toString(), "payload");
    assert.equal(Buffer.from(await fs.readFile("/binary")).toString(), "binary");
    if (runtime === "Rust") assert.equal(shell._companion, null);
  } finally {await shell.dispose();}
});

for (const runtime of ["TypeScript", "Rust"]) for (const owner of [{uid: 0, gid: 0}, {uid: 501, gid: 20}, {}, {uid: 501}, {gid: 20}]) {
  for (const options of ["", "-X", "-X -X-"]) test(`${runtime} ZIP source owner ${JSON.stringify(owner)} ${options}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = createMemoryFileSystem();
    await memory.writeFile("/source", Buffer.from("original"));
    const withOwner = stat => {
      const value = {...stat};
      delete value.uid; delete value.gid;
      return {...value, ...owner};
    };
    const fs = new Proxy(memory, {get(target, property) {
      if (property === "stat" || property === "lstat") return async (...args) => {
        const stat = await target[property](...args);
        return args[0] === "/source" ? withOwner(stat) : stat;
      };
      if (property === "openReadFile") return async (...args) => {
        const handle = await target.openReadFile(...args);
        return args[0] !== "/source" ? handle : new Proxy(handle, {get(reader, key) {
          if (key === "stat") return async (...options) => withOwner(await reader.stat(...options));
          const member = Reflect.get(reader, key, reader);
          return typeof member === "function" ? member.bind(reader) : member;
        }});
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }});
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands())
      : new RustWasmBash({fs, cwd: "/", forceNative: true});
    try {
      for (const payload of ["original", "replacement"]) {
        await memory.writeFile("/source", Buffer.from(payload));
        const result = await shell.exec(`zip -q ${options} sample.zip source`);
        assert.equal(result.exitCode, 0, result.stdout + result.stderr);
        const [entry] = entries(await memory.readFile("/sample.zip"));
        for (const record of [entry.local, entry.central]) {
          const ids = record.get(0x7875);
          if (options === "-X" || owner.uid === undefined || owner.gid === undefined) assert.equal(ids, undefined);
          else {
            assert.ok(ids);
            assert.equal(ids.length, 11);
            assert.deepEqual([ids[0], ids[1], ids[6]], [1, 4, 4]);
            assert.equal(ids.readUInt32LE(2), owner.uid);
            assert.equal(ids.readUInt32LE(7), owner.gid);
          }
        }
        const restored = await shell.exec("unzip -p sample.zip source");
        assert.equal(restored.exitCode, 0, restored.stderr);
        assert.equal(restored.stdout, payload);
      }
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
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
