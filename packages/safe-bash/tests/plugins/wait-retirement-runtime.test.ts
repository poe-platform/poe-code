import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { nextJobReference } from "../shell/extensions/jobs/next53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled wait status retirement at loop boundaries", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"] as const) {
    test(`${route}: native L1 retains the same operand across three iterations`, async context => {
      const source = `{ exit 7; } & child=$!; wait "$child"; for iteration in first second third; do who=old; wait -n -p who "$child"; result=$?; [[ \${who-} == "$child" ]]; match=$?; printf '%s:%s:%s:%s\\n' "$iteration" "$result" "\${who+x}" "$match"; done`;
      assert.equal(createHash("sha256").update(source).digest("hex"), "8387ad640e0d4b41130bd7a7aba5ec98c4ff1de70b56a188f94055f4e6c2cbaa");
      const reference = nextJobReference("L1", { source, stdin: Buffer.alloc(0) });
      assert.equal(reference.status, 0);
      assert.deepEqual(reference.stdout, Buffer.from("first:127::1\nsecond:7:x:0\nthird:7:x:0\n"));
      assert.deepEqual(reference.stderr, Buffer.alloc(0));
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
      if (route !== "inline") await fs.writeFile("/wait-retirement.sh", new TextEncoder().encode(source));
      const result = await shell.exec(route === "inline" ? source : `${route} /wait-retirement.sh`, { stdin: reference.stdin, env: { LC_ALL: "C" } });
      assert.equal(result.exitCode, reference.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, result.stderr);
      assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr, result.stderr);
    });
  }
});
