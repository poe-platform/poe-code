import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createFindCommand } from "./index.js";
import { evalSyncFind } from "./find.js";

for (const or of ["-o", "-or"]) {
  const cases = [
    { name: "reported name predicates", args: ["-name", "*.a", "-print", ",", "-name", "*.b", or, "-name", "*.c", "-print"], output: "/a.a\n/c.c\n" },
    { name: "OR on both sides of a comma", args: ["-true", or, "-print", ",", "-false", or, "-print"], output: "/a.a\n/b.b\n/c.c\n" },
    { name: "chained commas evaluate actions in order", args: ["-print", ",", "-true", or, "-print", ",", "-false", or, "-print"], output: "/a.a\n/a.a\n/b.b\n/b.b\n/c.c\n/c.c\n" },
    { name: "parenthesized list returns its right-hand value", args: ["(", "-print", ",", "-true", or, "-false", ")", "-a", "-print"], output: "/a.a\n/a.a\n/b.b\n/b.b\n/c.c\n/c.c\n" },
    { name: "false list result suppresses implicit print", args: ["-true", ",", "-false", or, "-false"], output: "" },
  ];
  for (const scenario of cases) {
    test(`find comma precedence with ${or}: ${scenario.name}`, async () => {
      const args = ["/a.a", "/b.b", "/c.c", ...scenario.args];
      const fs = createMemoryFileSystem();
      for (const path of args.slice(0, 3)) await fs.writeFile(path, new Uint8Array());
      let stdout = "", stderr = "";
      const result = await createFindCommand().execute({
        command: "find", args, cwd: "/", env: {}, fs, stdin: toByteSource(""),
        signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, scenario.output);
      assert.equal(evalSyncFind(args, "/", () => ({ type: "file", size: 0, mode: 0o644 })), scenario.output);
    });
  }
}

test("find comma awaits actions and preserves OR short-circuiting", async () => {
  const calls: string[] = [];
  const result = await createFindCommand().execute({
    command: "find", args: ["/", "-maxdepth", "0", "-exec", "probe", "left", ";", ",",
      "-exec", "probe", "right", ";", "-o", "-exec", "probe", "skipped", ";"],
    cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""),
    signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
    async invoke(_command, args) {
      await Promise.resolve();
      calls.push(args[0]!);
      return { exitCode: args[0] === "left" ? 1 : 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, ["left", "right"]);
});
