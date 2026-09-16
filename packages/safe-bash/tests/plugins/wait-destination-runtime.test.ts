import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { nextJobReference } from "../shell/extensions/jobs/next53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const cases = [
  {
    "id": 3,
    "name": "invalid option bytes preserve the destination",
    "source": "who=old; wait -p who -Z; result=$?; printf 'ascii:%s;who:%s\\n' \"$result\" \"$who\"; wait -p who $'-\\377'; result=$?; printf 'raw:%s;who:%s\\n' \"$result\" \"$who\"",
    "sourceSHA256": "57088d7e7e6d78f70cf54dafd7ad934fc8b72b21a80eadb39c101583a4144307",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "61736369693a323b77686f3a6f6c640a7261773a323b77686f3a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a202d5a3a20696e76616c6964206f7074696f6e0a776169743a2075736167653a2077616974205b2d666e5d205b2d70207661725d205b6964202e2e2e5d0a7368656c6c3a206c696e6520313a20776169743a202dff3a20696e76616c6964206f7074696f6e0a776169743a2075736167653a2077616974205b2d666e5d205b2d70207661725d205b6964202e2e2e5d0a"
  },
  {
    "id": 19,
    "name": "later missing destination argument preserves the first binding",
    "source": "who=old; wait -p who -p; result=$?; printf 'status:%s;set:%s;value:%s\\n' \"$result\" \"${who+x}\" \"${who-}\"",
    "sourceSHA256": "50c22df4a0d2f4533d31e1e596adf2175d7dfa6f8bc088ff1d8d40d041cefb74",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a323b7365743a783b76616c75653a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a202d703a206f7074696f6e20726571756972657320616e20617267756d656e740a776169743a2075736167653a2077616974205b2d666e5d205b2d70207661725d205b6964202e2e2e5d0a"
  },
  {
    "id": 21,
    "name": "only the final destination is validated and unbound",
    "source": "readonly locked=old; who=old; wait -n -p locked -p who; result=$?; printf 'readonly-first:%s;locked:%s;who:%s:%s\\n' \"$result\" \"$locked\" \"${who+x}\" \"${who-}\"; who=old; wait -n -p 9bad -p who; result=$?; printf 'invalid-first:%s;who:%s:%s\\n' \"$result\" \"${who+x}\" \"${who-}\"; who=old; wait -n -p who -p 9bad; result=$?; printf 'invalid-last:%s;who:%s:%s\\n' \"$result\" \"${who+x}\" \"${who-}\"",
    "sourceSHA256": "3120de2d9604f37822eccfd8322adbf97c6f1113d5b461a18152801c89ba9e15",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "726561646f6e6c792d66697273743a3132373b6c6f636b65643a6f6c643b77686f3a3a0a696e76616c69642d66697273743a3132373b77686f3a3a0a696e76616c69642d6c6173743a313b77686f3a783a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a206039626164273a206e6f7420612076616c6964206964656e7469666965720a"
  },
  {
    "id": 22,
    "name": "option-looking and empty destinations are identifiers, not options",
    "source": "who=old; wait -p --; result=$?; printf 'dashdash:%s;who:%s\\n' \"$result\" \"$who\"; wait -p -n; result=$?; printf 'dashn:%s;who:%s\\n' \"$result\" \"$who\"; wait -p ''; result=$?; printf 'empty:%s;who:%s\\n' \"$result\" \"$who\"; wait -- -p who; result=$?; printf 'terminated:%s;who:%s\\n' \"$result\" \"$who\"",
    "sourceSHA256": "abcfb1b3e74218c922ea672a9d70c50fc834b5f3b2f8f3e576b03c4ee72a75ea",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "64617368646173683a313b77686f3a6f6c640a646173686e3a313b77686f3a6f6c640a656d7074793a313b77686f3a6f6c640a7465726d696e617465643a313b77686f3a6f6c640a",
    "stderrHex": "7368656c6c3a206c696e6520313a20776169743a20602d2d273a206e6f7420612076616c6964206964656e7469666965720a7368656c6c3a206c696e6520313a20776169743a20602d6e273a206e6f7420612076616c6964206964656e7469666965720a7368656c6c3a206c696e6520313a20776169743a2060273a206e6f7420612076616c6964206964656e7469666965720a7368656c6c3a206c696e6520313a20776169743a20602d70273a206e6f74206120706964206f722076616c6964206a6f6220737065630a7368656c6c3a206c696e6520313a20776169743a206077686f273a206e6f74206120706964206f722076616c6964206a6f6220737065630a"
  }
] as const;

describe("compiled wait destination and option precedence", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const record of cases) {
    test("native25 case " + record.id + ": " + record.name, async context => {
      assert.equal(createHash("sha256").update(record.source).digest("hex"), record.sourceSHA256);
      const reference = nextJobReference(record.id, { source: record.source, stdin: Buffer.from(record.stdinHex, "hex") });
      assert.equal(reference.status, record.status);
      assert.deepEqual(reference.stdout, Buffer.from(record.stdoutHex, "hex"));
      assert.deepEqual(reference.stderr, Buffer.from(record.stderrHex, "hex"));
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const resources: { shell?: import("poe-code/safe-bash").Shell } = {};
      context.after(() => resources.shell?.dispose());
      const shell = new published.Shell({
        fs: createMemoryFileSystem(),
        extensions: [optional.jobsExtension()],
        limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 128 },
      });
      resources.shell = shell;
      shell.use(published.agentCommands());
      const result = await shell.exec(record.source, { stdin: reference.stdin, env: { LC_ALL: "C" } });
      assert.equal(result.exitCode, reference.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, result.stderr);
      assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr, result.stderr);
    });
  }
});
