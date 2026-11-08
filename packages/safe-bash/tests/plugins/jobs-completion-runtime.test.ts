import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { negationJobReference } from "../shell/extensions/jobs/negation53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled optional negated job completion", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"]) {
    for (const command of ["true", "false"]) {
      for (const restoring of [false, true]) {
        test(`${route}: ! ${command}, ${restoring ? "AND-list restoration" : "direct completion"}`, async context => {
          const published = await import("poe-code/safe-bash");
          const { createMemoryFileSystem } = await import("poe-code/safe-fs");
          const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
          const fs = createMemoryFileSystem();
          const shell = new published.Shell({ fs, extensions: [optional.jobsExtension()], limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 } }).use(published.agentCommands());
          context.after(() => shell.dispose());
          const reference = negationJobReference((restoring ? 2 : 0) + (command === "true" ? 1 : 2));
          if (route !== "inline") await fs.writeFile("/completion.sh", new TextEncoder().encode(reference.source));
          const result = await shell.exec(route === "inline" ? reference.source : `${route} /completion.sh`, { stdin: reference.stdin, env: { LC_ALL: "C" } });
          assert.equal(result.exitCode, reference.status);
          assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
          assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
        });
      }
    }
  }
});
