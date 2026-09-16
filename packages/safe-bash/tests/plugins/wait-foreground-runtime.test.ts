import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { foregroundJobReference } from "../shell/extensions/jobs/foreground53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

const cases = [
  {
    "id": 1,
    "name": "ordinary colon command",
    "source": "{ exit 7; } & child=$!; wait \"$child\"; :; wait -n -p who \"$child\"; result=$?; printf 'status:%s;set:%s\\n' \"$result\" \"${who+x}\"",
    "sourceSHA256": "cdc46f20e81838aa6c1ddac7fea69445285eae74c231e77327d4be901bc63f07",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a3132373b7365743a0a",
    "stderrHex": ""
  },
  {
    "id": 2,
    "name": "foreground subshell",
    "source": "{ exit 7; } & child=$!; wait \"$child\"; (:); wait -n -p who \"$child\"; result=$?; printf 'status:%s;set:%s\\n' \"$result\" \"${who+x}\"",
    "sourceSHA256": "1f7a7d209534065c47c4538306c67458c1f9bf5161777627602659ff814f9ae7",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a373b7365743a780a",
    "stderrHex": ""
  },
  {
    "id": 3,
    "name": "foreground pipeline",
    "source": "{ exit 7; } & child=$!; wait \"$child\"; : | :; wait -n -p who \"$child\"; result=$?; printf 'status:%s;set:%s\\n' \"$result\" \"${who+x}\"",
    "sourceSHA256": "0198c3f8a4dfc144d99619324a576c19eb03c3fd0a1ed5c11c2e7e801a6bf722",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a373b7365743a780a",
    "stderrHex": ""
  },
  {
    "id": 4,
    "name": "command substitution",
    "source": "{ exit 7; } & child=$!; wait \"$child\"; value=$(:); wait -n -p who \"$child\"; result=$?; printf 'status:%s;set:%s\\n' \"$result\" \"${who+x}\"",
    "sourceSHA256": "5b9cf6df88315d028a908709207320e54bb50961265a9f26d942e804c80a3347",
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "7374617475733a373b7365743a780a",
    "stderrHex": ""
  }
] as const;

describe("compiled wait status retention after foreground constructs", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"] as const) {
    for (const record of cases) {
      test(route + ": native foreground4 case " + record.id + ": " + record.name, async context => {
        assert.equal(createHash("sha256").update(record.source).digest("hex"), record.sourceSHA256);
        const reference = foregroundJobReference(record.id, { source: record.source, stdin: Buffer.from(record.stdinHex, "hex") });
        assert.equal(reference.status, record.status);
        assert.deepEqual(reference.stdout, Buffer.from(record.stdoutHex, "hex"));
        assert.deepEqual(reference.stderr, Buffer.from(record.stderrHex, "hex"));
        const published = await import("poe-code/safe-bash");
        const { createMemoryFileSystem } = await import("poe-code/safe-fs");
        const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
        const fs = createMemoryFileSystem();
        const resources: { shell?: import("poe-code/safe-bash").Shell } = {};
        context.after(() => resources.shell?.dispose());
        const shell = new published.Shell({
          fs,
          extensions: [optional.jobsExtension()],
          limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 128 },
        });
        resources.shell = shell;
        shell.use(published.agentCommands());
        if (route !== "inline") await fs.writeFile("/wait-foreground.sh", new TextEncoder().encode(record.source));
        const result = await shell.exec(route === "inline" ? record.source : route + " /wait-foreground.sh", { stdin: Buffer.from(record.stdinHex, "hex"), env: { LC_ALL: "C" } });
        assert.equal(result.exitCode, record.status, result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(record.stdoutHex, "hex"), result.stderr);
        assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(record.stderrHex, "hex"), result.stderr);
      });
    }
  }
});
