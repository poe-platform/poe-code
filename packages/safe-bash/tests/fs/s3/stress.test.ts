import assert from "node:assert/strict";
import test from "node:test";
import { isFsError } from "../../../src/contracts/errors.js";
import { MockS3Client, S3FileSystem } from "../../../src/fs/s3/index.js";

for (const seed of [0x1234abcd, 0x7fffffff, 0xc0ffee]) {
  test(`seeded mixed-operation conformance against independent byte model: ${seed}`, async () => {
    let state = seed;
    const random = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const client = new MockS3Client({ buckets: ["bucket"], pageSize: 1 });
    const fs = new S3FileSystem({ transport: client, bucket: "bucket", prefix: "confined", allowNonAtomicRename: true });
    const model = new Map<string, Uint8Array>();
    const names = ["a", "b", "c", "é", "😀", "space ?", "literal%2F", "back\\slash", "x", "y"];
    for (let iteration = 0; iteration < 500; iteration++) {
      const name = names[random() % names.length]!;
      const target = names[random() % names.length]!;
      const payload = Uint8Array.from({ length: random() % 12 }, () => random() & 255);
      const previous = model.get(name);
      switch (random() % 7) {
        case 0:
          await fs.writeFile(`/${name}`, payload);
          model.set(name, new Uint8Array(payload));
          break;
        case 1: {
          await fs.appendFile(`/${name}`, payload);
          const result = new Uint8Array((previous?.length ?? 0) + payload.length);
          if (previous) result.set(previous);
          result.set(payload, previous?.length ?? 0);
          model.set(name, result);
          break;
        }
        case 2:
          if (previous) assert.deepEqual(await fs.readFile(`/${name}`), previous);
          else await assert.rejects(fs.readFile(`/${name}`), (error) => isFsError(error, "ENOENT"));
          break;
        case 3:
          await fs.rm(`/${name}`, { force: true });
          model.delete(name);
          break;
        case 4:
          if (previous) {
            await fs.copyFile(`/${name}`, `/${target}`);
            model.set(target, new Uint8Array(previous));
          } else await assert.rejects(fs.copyFile(`/${name}`, `/${target}`), (error) => isFsError(error, "ENOENT"));
          break;
        case 5:
          if (previous) {
            await fs.rename(`/${name}`, `/${target}`);
            if (name !== target) {
              model.delete(name);
              model.set(target, new Uint8Array(previous));
            }
          } else await assert.rejects(fs.rename(`/${name}`, `/${target}`), (error) => isFsError(error, "ENOENT"));
          break;
        case 6:
          if (previous) await assert.rejects(fs.writeFile(`/${name}`, payload, { flag: "wx" }), (error) => isFsError(error, "EEXIST"));
          else {
            await fs.writeFile(`/${name}`, payload, { flag: "wx" });
            model.set(name, new Uint8Array(payload));
          }
          break;
      }
      if (iteration % 25 === 0 || iteration === 499) {
        const expectedNames = [...model.keys()].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
        assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), expectedNames);
        for (const [key, expected] of model) {
          assert.deepEqual(await fs.readFile(`/${key}`), expected);
          assert.equal((await fs.stat(`/${key}`)).size, expected.length);
        }
      }
    }
  });
}
