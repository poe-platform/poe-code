import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { createIconvCommands } from "../../src/commands/iconv/index.js";
import { createFactorCommands } from "../../src/commands/factor/index.js";
import { createLineEndingCommands } from "../../src/commands/line-endings/index.js";
import { createBoundedRegexProvider } from "../../src/commands/regex-execution/bounded-provider.js";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/shell.js";
import { chunks, fixture } from "./helpers.js";

const cases = [
  { command: "sort", args: [], input: "b tenant\na tenant\n", expected: "a tenant\nb tenant\n" },
  { command: "sort", args: ["-k1,1n"], input: "2 tenant\n1 tenant\n", expected: "1 tenant\n2 tenant\n" },
  { command: "tr", args: ["a-z", "A-Z"], input: "tenant first\ntenant other\n", expected: "TENANT FIRST\nTENANT OTHER\n" },
  { command: "tr", args: ["-ds", "x", "a"], input: "xaa\nxbb\n", expected: "a\nbb\n" },
  { command: "grep", args: ["TENANT"], input: "TENANT first\nTENANT other\n", expected: "TENANT first\nTENANT other\n" },
  { command: "iconv", args: ["-f", "UTF-8", "-t", "UTF-8"], input: "first\n".repeat(6000) + "other\n".repeat(6000), expected: "first\n".repeat(6000) + "other\n".repeat(6000) },
  { command: "dos2unix", args: [], input: "first\r\n".repeat(4000) + "other\r\n".repeat(4000), expected: "first\n".repeat(4000) + "other\n".repeat(4000) },
  { command: "unix2dos", args: [], input: "first\n".repeat(4000) + "other\n".repeat(4000), expected: "first\r\n".repeat(4000) + "other\r\n".repeat(4000) },
  { command: "factor", args: [], input: "6\n".repeat(100) + "35\n".repeat(100), expected: "6: 2 3\n".repeat(100) + "35: 5 7\n".repeat(100) },
];

for (const fallback of [false, true]) {
  for (const scenario of cases) {
    test(`${scenario.command} ${scenario.args.join(" ")} retains output across chunks and invocations (sync refusal=${fallback})`, async () => {
      const registry = new CommandRegistry();
      await standardCommands({ regexExecutor: createBoundedRegexProvider() }).setup({ commands: registry, use() {}, registerFileSystem() {} });
      for (const command of [...createIconvCommands(), ...createFactorCommands(), ...createLineEndingCommands()]) registry.register(command);
      const retained: Uint8Array[] = [];
      const context: CommandContext = {
        command: scenario.command, args: scenario.args, cwd: "/work", env: {},
        fs: await fixture(), signal: new AbortController().signal,
        stdin: chunks(scenario.input, 8192),
        stdout: {
          async write(bytes) { retained.push(bytes); },
          ...(fallback ? { writeSync() { return false; } } : {}),
        },
        stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
      };
      const command = registry.get(scenario.command)!;
      assert.equal((await command.execute(context)).exitCode, 0);
      const first = retained.slice();
      assert.equal(Buffer.concat(first).toString(), scenario.expected);
      assert.equal((await command.execute({ ...context, stdin: toByteSource(scenario.input) })).exitCode, 0);
      assert.equal(Buffer.concat(first).toString(), scenario.expected);
      assert.equal(Buffer.concat(retained).toString(), scenario.expected.repeat(2));
      if (scenario.input.length > 32768) assert.ok(first.length > 1, "exercise buffer reuse");
    });
  }
}

for (const args of ["", "-k1,1n"]) {
  for (const redirected of [false, true]) {
    test(`concurrent sort ${args} isolates tenants (redirected=${redirected})`, async context => {
      const tenants = await Promise.all(["SEC_A", "PUB_B"].map(async tenant => {
        const rows = Array.from({ length: 3600 }, (_, index) => `${3600 - index} ${tenant}_${index}`);
        const fs = await fixture({ "in.txt": rows.join("\n") + "\n" });
        const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
        context.after(() => shell.dispose());
        const expected = (args ? rows.reverse() : rows.sort()).join("\n") + "\n";
        return { fs, shell, expected };
      }));
      const results = await Promise.all(tenants.map(({ shell }) => shell.exec(`sort ${args} < in.txt${redirected ? " > out.txt; cat out.txt" : ""}`)));
      for (const [index, result] of results.entries()) {
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, tenants[index]!.expected);
        if (redirected) assert.equal(new TextDecoder().decode(await tenants[index]!.fs.readFile("/work/out.txt")), tenants[index]!.expected);
      }
    });
  }
}
