import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { grammarJobReference } from "../shell/extensions/jobs/grammar53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = { jobsExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

function pidDiagnostics(pid: string): Buffer {
  assert.ok(pid.length > 0 && pid[0] !== "0" && [...pid].every(character => character >= "0" && character <= "9"));
  return Buffer.from(["+", " ", "-"].map(prefix => `shell: line 1: wait: \`${prefix}${pid}': not a pid or valid job spec\n`).join(""));
}

function scriptDiagnostics(bytes: Buffer, id: number): Buffer {
  const prefix = Buffer.from("shell: line 1: wait: ");
  const result: Buffer[] = [];
  let mapped = 0;
  for (let offset = 0; offset < bytes.length;) {
    const end = bytes.indexOf(10, offset);
    assert.ok(end >= offset);
    const line = bytes.subarray(offset, end + 1);
    if (line.subarray(0, prefix.length).equals(prefix)) {
      result.push(Buffer.from("/grammar.sh: line 1: wait: "), line.subarray(prefix.length));
      mapped++;
    } else {
      assert.deepEqual(line, Buffer.from("wait: usage: wait [-fn] [-p var] [id ...]\n"));
      result.push(line);
    }
    offset = end + 1;
  }
  assert.equal(mapped, id === 2 ? 0 : id === 3 ? 1 : 2);
  return Buffer.concat(result);
}

describe("compiled optional wait grammar", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const route of ["inline", "bash", "sh"]) {
    for (const id of route === "inline" ? [1, 2, 3, 4, 5, 6, 7, 8] : [2, 3, 8]) {
      test(`${route}: ${route === "inline" ? "authenticated Bash 5.3 grammar" : "VFS counterpart of grammar"} case ${id}`, async context => {
        const published = await import("poe-code/safe-bash");
        const { createMemoryFileSystem } = await import("poe-code/safe-fs");
        const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
        const definition = optional.jobsExtension();
        const observed: string[] = [];
        const extension: Extension = id === 1 ? { ...definition, create() {
          const instance = definition.create();
          return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
            const child = invocation.variable("child");
            assert.ok(child);
            observed.push(child);
            return builtin.execute.call(builtin, invocation);
          } })) };
        } } : definition;
        const fs = createMemoryFileSystem();
        const shell = new published.Shell({ fs, extensions: [extension], env: { LC_ALL: "C" },
          limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 },
        }).use(published.agentCommands());
        context.after(() => shell.dispose());
        const reference = grammarJobReference(id);
        if (route !== "inline") await fs.writeFile("/grammar.sh", new TextEncoder().encode(reference.source));
        const result = await shell.exec(route === "inline" ? reference.source : `${route} /grammar.sh`, { stdin: reference.stdin });
        assert.equal(result.exitCode, reference.status);
        assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
        if (id === 1) {
          assert.equal(observed.length, 4);
          assert.equal(new Set(observed).size, 1);
          assert.deepEqual(reference.stderr, pidDiagnostics("81836"));
          assert.deepEqual(Buffer.from(result.stderrBytes), pidDiagnostics(observed[0]!));
        } else assert.deepEqual(Buffer.from(result.stderrBytes), route === "inline" ? reference.stderr : scriptDiagnostics(reference.stderr, id));
      });
    }
  }
});
