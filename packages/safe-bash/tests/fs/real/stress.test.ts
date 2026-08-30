import assert from "node:assert/strict";
import { constants } from "node:fs";
import * as native from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bytes, errno, fixture, text } from "./helpers.js";

function randomSequence(seed: number) {
  let state = seed;
  return (maximum: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % maximum;
  };
}

async function outcome(action: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await action();
    return result instanceof Uint8Array ? { bytes: [...result] } : { value: result };
  } catch (error) {
    const failure = error as { code?: string; info?: { code?: string } };
    return { code: failure.info?.code ?? failure.code };
  }
}

test("400 deterministic mixed operations agree with an independent native filesystem", async (context) => {
  const { filesystem, temporary } = await fixture(context);
  const oracleRoot = join(temporary, "oracle");
  await native.mkdir(oracleRoot);
  const paths = ["alpha", "beta", "gamma", "dir", "dir/child", "nested/deep/file", "nested", "nested/deep"];
  const next = randomSequence(0xc0ffee);
  for (let step = 0; step < 400; step++) {
    const source = paths[next(paths.length)]!;
    const destination = paths[next(paths.length)]!;
    const hostSource = join(oracleRoot, source);
    const hostDestination = join(oracleRoot, destination);
    const data = bytes(`step-${step}:${next(1000)}`);
    const operation = next(11);
    let actual: unknown;
    let expected: unknown;
    switch (operation) {
      case 0: {
        const flag = (["w", "a", "wx", "ax"] as const)[next(4)]!;
        actual = await outcome(() => filesystem.writeFile(source, data, { flag }));
        expected = await outcome(() => native.writeFile(hostSource, data, { flag }));
        break;
      }
      case 1:
        actual = await outcome(() => filesystem.appendFile(source, data));
        expected = await outcome(() => native.appendFile(hostSource, data));
        break;
      case 2:
        actual = await outcome(() => filesystem.readFile(source));
        expected = await outcome(() => native.readFile(hostSource));
        break;
      case 3: {
        const recursive = next(2) === 0;
        actual = await outcome(() => filesystem.mkdir(source, { recursive }));
        expected = await outcome(async () => { await native.mkdir(hostSource, { recursive }); });
        break;
      }
      case 4: {
        const recursive = next(2) === 0;
        const force = next(2) === 0;
        actual = await outcome(() => filesystem.rm(source, { recursive, force }));
        expected = await outcome(() => native.rm(hostSource, { recursive, force }));
        break;
      }
      case 5:
        actual = await outcome(() => filesystem.rename(source, destination));
        expected = await outcome(() => native.rename(hostSource, hostDestination));
        break;
      case 6: {
        const exclusive = next(2) === 0;
        actual = await outcome(() => filesystem.copyFile(source, destination, { exclusive }));
        expected = await outcome(() => native.copyFile(hostSource, hostDestination, exclusive ? constants.COPYFILE_EXCL : 0));
        break;
      }
      case 7: {
        const length = next(20);
        actual = await outcome(() => filesystem.truncate(source, length));
        expected = await outcome(() => native.truncate(hostSource, length));
        break;
      }
      case 8:
        actual = await outcome(() => filesystem.chmod(source, 0o700));
        expected = await outcome(() => native.chmod(hostSource, 0o700));
        break;
      case 9:
        actual = await outcome(() => filesystem.access(source));
        expected = await outcome(() => native.access(hostSource));
        break;
      default:
        actual = await outcome(async () => (await filesystem.stat(source)).type);
        expected = await outcome(async () => (await native.stat(hostSource)).isDirectory() ? "directory" : "file");
    }
    assert.deepEqual(actual, expected, `step=${step} operation=${operation} source=${source} destination=${destination}`);
  }
  for (const path of paths) {
    assert.deepEqual(await outcome(() => filesystem.readFile(path)), await outcome(() => native.readFile(join(oracleRoot, path))), path);
  }
});

test("concurrent independent writes, appends, reads, and renames preserve all data", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("files");
  await filesystem.mkdir("moved");
  const count = 64;
  await Promise.all(Array.from({ length: count }, async (_, index) => {
    const path = `files/${index}`;
    await filesystem.writeFile(path, bytes(`file-${index}:`), { flag: "wx" });
    await filesystem.appendFile(path, new Uint8Array([index, 0, 255]));
    await filesystem.rename(path, `moved/${index}`);
    const result = await filesystem.readFile(`moved/${index}`);
    assert.equal(text(result.subarray(0, result.length - 3)), `file-${index}:`);
    assert.deepEqual([...result.subarray(-3)], [index, 0, 255]);
  }));
  assert.equal((await filesystem.readdir("files")).length, 0);
  assert.equal((await filesystem.readdir("moved")).length, count);
  await filesystem.rm("moved", { recursive: true });
});

test("exclusive concurrent creation has exactly one winner", async (context) => {
  const { filesystem } = await fixture(context);
  const attempts = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => (
    filesystem.writeFile("single", bytes(`winner-${index}`), { flag: "wx" })
  )));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  for (const attempt of attempts) {
    if (attempt.status === "rejected") errno("EEXIST")(attempt.reason);
  }
  const winner = attempts.findIndex((attempt) => attempt.status === "fulfilled");
  assert.equal(text(await filesystem.readFile("single")), `winner-${winner}`);
});

test("multi-megabyte streaming and bounded rejection leave subsequent access usable", async (context) => {
  const { filesystem } = await fixture(context);
  const chunk = Uint8Array.from({ length: 16 * 1024 }, (_, index) => index % 251);
  await filesystem.writeStream("large", (async function* () {
    for (let index = 0; index < 160; index++) yield chunk;
  })());
  let total = 0;
  for await (const actual of filesystem.readStream("large", { chunkSize: chunk.length })) {
    assert.deepEqual(actual, chunk);
    total += actual.length;
  }
  assert.equal(total, chunk.length * 160);
  for (let attempt = 0; attempt < 20; attempt++) {
    await assert.rejects(filesystem.readFile("large", { maxBytes: 1 }), errno("EFBIG"));
  }
  await filesystem.truncate("large", 3);
  assert.deepEqual(await filesystem.readFile("large"), new Uint8Array([0, 1, 2]));
});
