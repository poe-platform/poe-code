import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { createFindCommand } from "./index.js";

async function run(fs: FileSystem, args: string[]) {
  let stdout = "", stderr = "";
  const result = await createFindCommand().execute({
    command: "find", args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

for (const [predicate, field] of [["-atime", "atimeMs"], ["-ctime", "ctimeMs"]] as const) {
  for (const [operand, expected] of [
    ["0", ["zero", "below-one"]], ["1", ["one", "below-two"]],
    ["+1", ["above-two"]], ["-1", ["future", "zero", "below-one", "one"]],
    ["+0", ["below-two", "two", "above-two"]], ["-0", ["future", "zero"]],
  ] as const) {
    test(`find ${predicate} ${operand} uses the selected timestamp and day boundaries`, async context => {
      const now = 1_700_000_000_000;
      const day = 86_400_000;
      context.mock.method(Date, "now", () => now);
      const ages = { future: -1, zero: 0, "below-one": day - 1, one: day, "below-two": day * 2 - 1, two: day * 2, "above-two": day * 2 + 1 };
      const fs = createMemoryFileSystem();
      for (const name of Object.keys(ages)) await fs.writeFile(`/${name}`, new Uint8Array());
      const lstat = fs.lstat.bind(fs);
      context.mock.method(fs, "lstat", async (path: string) => ({
        ...await lstat(path), mtimeMs: 0, [field]: now - ages[path.slice(1) as keyof typeof ages],
      }));
      assert.deepEqual(await run(fs, [...Object.keys(ages), predicate, operand]),
        { exitCode: 0, stdout: expected.map(name => `${name}\n`).join(""), stderr: "" });
    });
  }

  for (const operand of [undefined, "", "x", "1.5", "--1", "++1", "1e2", "9007199254740991"]) {
    test(`find ${predicate} rejects ${JSON.stringify(operand)} before deleting`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/keep", new Uint8Array());
      const result = await run(fs, ["keep", "-delete", predicate, ...(operand === undefined ? [] : [operand])]);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /requires an argument|invalid.*(time|number)/u);
      assert.ok(await fs.lstat("/keep"));
    });
  }
}
