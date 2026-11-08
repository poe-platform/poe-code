import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const cases = [
  {
    "id": 1,
    "name": "next-wait without children unsets the destination",
    "source": "who=old; wait -n -p who; result=$?; printf 'status:%s;set:%s\\n' \"$result\" \"${who+x}\"",
    "sourceSHA256": "5739550fbcebf101d83a5dc056711b226e990df49e3b513efff3658143d642d4",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a3132373b7365743a0a",
    "stderrHex": ""
  },
  {
    "id": 2,
    "name": "missing destination option argument preserves prior bindings",
    "source": "who=old; wait -n -p; result=$?; printf 'status:%s;who:%s\\n' \"$result\" \"$who\"",
    "sourceSHA256": "51b23e2744802ae6756bbd576ac3e5b183cb13002e7bc01703c418f660d35b4a",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a323b77686f3a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a202d703a206f7074696f6e20726571756972657320616e20617267756d656e740a776169743a2075736167653a2077616974205b2d666e5d205b2d70207661725d205b6964202e2e2e5d0a"
  },
  {
    "id": 4,
    "name": "invalid destination precedes operand validation",
    "source": "who=old; wait -n -p '9bad' 0; result=$?; printf 'status:%s;who:%s\\n' \"$result\" \"$who\"",
    "sourceSHA256": "7869b4f5bd614722ebdf22d3628f0063ca78ff8dc7c98c7fd2e5c50aac6d14f5",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a313b77686f3a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a206039626164273a206e6f7420612076616c6964206964656e7469666965720a"
  },
  {
    "id": 5,
    "name": "readonly destination refuses early unbinding",
    "source": "readonly who=old; wait -n -p who 0; result=$?; printf 'status:%s;who:%s\\n' \"$result\" \"$who\"",
    "sourceSHA256": "67ccafede0b15de33914caca2f61675cb2ca75eb977b7c56b63214f3142393ba",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a313b77686f3a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a2077686f3a2063616e6e6f7420756e7365743a20726561646f6e6c79207661726961626c650a"
  },
  {
    "id": 6,
    "name": "ordinary wait without children unsets the destination",
    "source": "who=old; wait -p who; result=$?; printf 'status:%s;set:%s\\n' \"$result\" \"${who+x}\"",
    "sourceSHA256": "3cfc84831876586b74a9fdc1310d2b377e9bd0e2d802f4f0d0896482121a5aa5",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a303b7365743a0a",
    "stderrHex": ""
  },
  {
    "id": 20,
    "name": "only the final repeated destination is unset",
    "source": "first=left; second=right; wait -n -p first -p second; result=$?; printf 'status:%s;first:%s:%s;second:%s:%s\\n' \"$result\" \"${first+x}\" \"${first-}\" \"${second+x}\" \"${second-}\"",
    "sourceSHA256": "97066eae4b1bca04bd5ca6ec5ef5e29d6526206a0d753cdc51f4fb2f43ec43dc",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a3132373b66697273743a783a6c6566743b7365636f6e643a3a0a",
    "stderrHex": ""
  }
] as const;

describe("compiled wait options: exact pinned Bash 5.3 requests", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const record of cases) {
    test("native25 case " + record.id + ": " + record.name, async context => {
      assert.equal(createHash("sha256").update(record.source).digest("hex"), record.sourceSHA256);
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const resources: { shell?: import("poe-code/safe-bash").Shell } = {};
      context.after(() => resources.shell?.dispose());
      const shell = new published.Shell({
        fs: createMemoryFileSystem(),
        extensions: [optional.jobsExtension()],
        limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 64 },
      });
      resources.shell = shell;
      shell.use(published.agentCommands());
      const result = await shell.exec(record.source, { env: { LC_ALL: "C" }, stdin: Buffer.from(record.stdinHex, "hex") });
      assert.equal(result.exitCode, record.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(record.stdoutHex, "hex"), result.stderr);
      assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(record.stderrHex, "hex"), result.stderr);
    });
  }
});
