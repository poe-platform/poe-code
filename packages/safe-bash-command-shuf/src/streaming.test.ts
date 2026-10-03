import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { createShufCommand } from "./index.js";

for (const args of [["/input"], ["--random-source=/entropy", "/input"], ["-r", "-n2", "/input"], ["/input", "-o", "/input"], ["-n1"]]) {
  test(`large records use bounded transfers and caller-authorized spill storage: ${args.join(" ")}`, async () => {
    const backing = createMemoryFileSystem();
    await backing.mkdir("/spill");
    const input = new Uint8Array(1_100_001).fill(120); input[input.length - 1] = 10;
    await backing.writeFile("/input", input);
    await backing.writeFile("/entropy", new Uint8Array(64));
    let opens = 0, writes = 0, reads = 0, output = 0;
    const fs: FileSystem = new Proxy(backing, { get(target, property) {
      if (property === "readFile") return () => { throw new Error("whole-file reads are forbidden"); };
      if (property === "open") return async (path: string, options: Parameters<NonNullable<FileSystem["open"]>>[1]) => {
        assert.ok(path.startsWith("/spill/.shuf-"), path); opens++;
        const descriptor = await target.open!(path, options);
        return new Proxy(descriptor, { get(handle, key) {
          if (key === "write") return async (bytes: Uint8Array, position: number | null, controls?: Parameters<typeof descriptor.write>[2]) => {
            assert.ok(bytes.length <= 16384); writes++; return descriptor.write(bytes, position, controls);
          };
          if (key === "read") return async (bytes: Uint8Array, position: number | null, controls?: Parameters<typeof descriptor.read>[2]) => {
            assert.ok(bytes.length <= 16384); reads++; return descriptor.read(bytes, position, controls);
          };
          const method = Reflect.get(handle, key, handle);
          return typeof method === "function" ? method.bind(handle) : method;
        } });
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    let stderr = "";
    const result = await createShufCommand().execute({
      command: "shuf", args, fs, cwd: "/", env: { TMPDIR: "/spill" },
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < input.length; offset += 16384) yield input.subarray(offset, offset + 16384); } },
      stdout: { async write(bytes) { assert.ok(bytes.length <= 65536, `unbounded output chunk: ${bytes.length}`); output += bytes.length; } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output, args.includes("-o") ? 0 : input.length * (args.includes("-r") ? 2 : 1));
    assert.deepEqual(await backing.readFile("/input"), input);
    assert.ok(opens > 0 && reads > 0 && writes > 0, "input never reached the supplied spill backend");
    assert.deepEqual(await backing.readdir("/spill"), []);
  });
}

test("scratch paths never fall back to the host filesystem", async () => {
  const fs = createMemoryFileSystem();
  let stderr = "";
  const result = await createShufCommand().execute({
    command: "shuf", args: [], fs, cwd: "/", env: { TMPDIR: "/private/tmp" },
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { for (let i = 0; i < 70; i++) yield new Uint8Array(16384).fill(120); } },
    stdout: { async write() { assert.fail("inaccessible backing storage must not produce output"); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.includes("No such file or directory"), stderr);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("spilling cannot make a previously missing random-source alias readable", async () => {
  const backing = createMemoryFileSystem();
  const bytes = new Uint8Array(1_100_001).fill(120); bytes[bytes.length - 1] = 10;
  await backing.writeFile("/input", bytes);
  let scratch = "", stderr = "";
  const fs = new Proxy(backing, { get(target, key) {
    if (key === "open") return (...args: Parameters<NonNullable<typeof target.open>>) => {
      scratch = args[0]; return target.open!(...args);
    };
    if (key === "openReadFile") return (path: string, options?: Parameters<NonNullable<typeof target.openReadFile>>[1]) => {
      if (path === "/random-alias") {
        assert.ok(scratch, "input must precede random-source admission");
        return target.openReadFile!(scratch, options);
      }
      return target.openReadFile!(path, options);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await createShufCommand().execute({
    command: "shuf", args: ["/input", "--random-source=/random-alias"], fs, cwd: "/", env: { LC_ALL: "C" },
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() { assert.fail("missing random source must not produce output"); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(stderr, "shuf: /random-alias: No such file or directory\n");
  assert.deepEqual((await backing.readdir("/")).map(entry => entry.name), ["input"]);
});
