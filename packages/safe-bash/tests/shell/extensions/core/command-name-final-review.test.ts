import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueFromBytes } from "../../../../src/contracts/value.js";
import type { ValueAllocation } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { diagnosticCommandName } from "../../../../src/shell/diagnostic-name.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { ValueArena } from "../../../../src/shell/value-state.js";

const referenceBytes = readFileSync(new URL("./command-name-final-review-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "827a06c0933968ac36df08a9f7d666cae9a904132c59647524712c2b7dfe5ece");
const reference = JSON.parse(referenceBytes.toString()) as {
  oracle: { sha256: string };
  records: { name: string; locale: string; source: string; expected: { status: number; stdoutHex: string; stderrHex: string } }[];
};
assert.equal(reference.oracle.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.records.length, 12);

function setup(locale: string): Shell {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: locale } });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const fixture of reference.records) test(`final command-name native 5.3: ${fixture.name}`, async context => {
  const shell = setup(fixture.locale);
  context.after(() => shell.dispose());
  const result = await shell.exec(fixture.source);
  assert.equal(result.exitCode, fixture.expected.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(fixture.expected.stdoutHex, "hex"));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(fixture.expected.stderrHex, "hex"));
});

for (const locale of ["C", "C.UTF-8"]) {
  for (const mode of ["observe", "freeze", "assign-identical", "assign-restore", "define-identical", "accessor-identical"] as const) {
    test(`final command-name public context: ${locale} ${mode}`, async context => {
      const shell = setup(locale);
      context.after(() => shell.dispose());
      const observations: string[] = [];
      let cleanups = 0;
      shell.use(async (invocation, next) => {
        const original = invocation.command;
        observations.push(original, { ...invocation }.command, Object.assign({}, invocation).command);
        if (mode === "freeze") Object.freeze(invocation);
        else if (mode === "assign-identical") Object.assign(invocation, { command: original });
        else if (mode === "assign-restore") {
          Object.assign(invocation, { command: "different_missing" });
          Object.assign(invocation, { command: original });
        } else if (mode === "define-identical") Object.defineProperty(invocation, "command", { value: original });
        else if (mode === "accessor-identical") Object.defineProperty(invocation, "command", { get: () => original });
        invocation.registerCleanup!(() => { cleanups++; });
        await Promise.resolve();
        observations.push(invocation.command);
        return next();
      });
      const result = await shell.exec("$'\\303\\251\\377\\344\\270\\255'");
      const originalBytes = mode === "observe" || mode === "freeze";
      const rendered = locale === "C"
        ? `$'\\303\\251${originalBytes ? "\\377" : "\\357\\277\\275"}\\344\\270\\255'`
        : originalBytes ? "$'é\\377中'" : "é�中";
      assert.equal(result.exitCode, 127);
      assert.equal(result.stdout, "");
      assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(`shell: line 1: ${rendered}: command not found\n`));
      assert.deepEqual(observations, ["é�中", "é�中", "é�中", "é�中"]);
      assert.equal(cleanups, 1);
    });
  }
}

const renderedDiagnostic = "shell: line 1: $'é\\377中': command not found\n";
const diagnosticLength = Buffer.byteLength(renderedDiagnostic);
for (const maximum of [0, 1, diagnosticLength, diagnosticLength + 1]) {
  test(`final command-name UTF8 output bytes admission ${maximum}`, async context => {
    const shell = setup("C.UTF-8");
    context.after(() => shell.dispose());
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const running = shell.exec("printf x; $'\\303\\251\\377\\344\\270\\255'", {
      limits: { maxOutputBytes: maximum },
      stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
    });
    if (maximum === diagnosticLength + 1) assert.equal((await running).exitCode, 127);
    else await assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(Buffer.concat(stdout), maximum === 0 ? Buffer.alloc(0) : Buffer.from("x"));
    assert.deepEqual(Buffer.concat(stderr), maximum === diagnosticLength + 1 ? Buffer.from(renderedDiagnostic) : Buffer.alloc(0));
  });
}

for (const phase of ["reserve", "commit"] as const) for (const stage of [1, 2, 3]) {
  for (const reason of [undefined, false, -0, NaN]) {
    test(`final command-name allocation ${phase} stage ${stage} exact ${String(reason)}`, () => {
      const arena = new ValueArena(1024, 16, () => {});
      const scope = arena.scope();
      const requests: number[] = [], releases: number[] = [];
      const allocation: ValueAllocation = {
        assertOpen: () => scope.assertOpen(),
        reserve(bytes, slots) {
          requests.push(bytes);
          const ordinal = requests.length;
          if (phase === "reserve" && ordinal === stage) throw reason;
          const reservation = scope.reserve(bytes, slots);
          return {
            commit(value) {
              if (phase === "commit" && ordinal === stage) throw reason;
              reservation.commit(value);
            },
            release() { releases.push(ordinal); reservation.release(); },
          };
        },
      };
      const input = shellValueFromBytes(Uint8Array.of(195, 169, 255, 228, 184, 173, 10));
      let threw = false;
      let caught: unknown;
      try { diagnosticCommandName(input, false, allocation); }
      catch (error) { threw = true; caught = error; }
      finally { scope.close(); arena.close(); }
      assert.equal(threw, true);
      assert.ok(Object.is(caught, reason));
      assert.deepEqual(requests, [71, 14, 106].slice(0, stage));
      const expectedReleases = phase === "reserve" ? stage === 3 ? [2] : [] : stage === 3 ? [3, 2] : [stage];
      assert.deepEqual(releases, expectedReleases);
      assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
    });
  }
}
