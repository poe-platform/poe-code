import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled extension evaluation exit ownership", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const invocation of ["probe", "command probe", "builtin probe"]) {
    test(`callback exit unwinds before owned cleanup through ${invocation}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem } = await import("poe-code/safe-fs");
      const events: string[] = [];
      const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [{
        name: "evaluation-exit", runtimeIdentity: published.commandRuntimeIdentity,
        create: () => ({ builtins: [{ name: "probe", async execute(context) {
          context.registerCleanup(() => { events.push("cleanup"); });
          try {
            const status = await context.evaluate("callback");
            events.push("returned");
            return status;
          } finally { events.push("unwind"); }
        } }] }),
      }] }).use(published.agentCommands());
      try {
        const result = await shell.exec(`callback() { exit 7; }; ${invocation}; printf after`);
        assert.equal(result.exitCode, 7, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(events, ["unwind", "cleanup"]);
      } finally { await shell.dispose(); }
    });
  }

  test("optional EXIT trap retains raw callback locals before deferred cleanup", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
    const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as { trapExtension(): Extension };
    const events: string[] = [];
    const shell = new published.Shell({ fs: createMemoryFileSystem(), extensions: [optional.trapExtension(), {
      name: "evaluation-exit-locals", runtimeIdentity: published.commandRuntimeIdentity,
      create: () => ({ builtins: [{ name: "probe", async execute(context) {
        context.registerCleanup(() => { events.push("cleanup"); });
        try {
          const status = await context.evaluate("callback");
          events.push("returned");
          return status;
        } finally { events.push("unwind"); }
      } }] }),
    }] }).use(published.agentCommands());
    try {
      const result = await shell.exec(`trap 'printf "%s" "$value"; exit 9' EXIT; value=outer; callback() { local value=$'\\377'; exit 7; }; probe; printf after`);
      assert.equal(result.exitCode, 9, result.stderr);
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(255));
      assert.equal(result.stderr, "");
      assert.deepEqual(events, ["unwind", "cleanup"]);
    } finally { await shell.dispose(); }
  });
});
