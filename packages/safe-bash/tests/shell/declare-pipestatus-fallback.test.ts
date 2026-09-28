import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { requireArrays, stateMonitor, trackState } from "../../src/shell/arrays/state.js";
import { InvocationScope } from "../../src/shell/cleanup.js";
import { publishPipelineStatus } from "../../src/shell/pipestatus.js";
import { RootShellState } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";

const cases = [
  'a=(1); f() { unset "PIPESTATUS[0]"; }; f; say "$?:${PIPESTATUS[*]}"',
  'a=(1); eval \'unset "PIPESTATUS[0]"; eval ""\'; say "$?:${PIPESTATUS[*]}"',
  'false; declare -a a=(1 2); say "pipe=${PIPESTATUS[0]} status=$?"',
  'false; declare -a a; say "pipe=${PIPESTATUS[0]} status=$?"',
  'false; declare -A a=([key]=value); say "pipe=${PIPESTATUS[0]} status=$?"',
  'a=(old); declare -a a+=(new) b=([0]=$(say hi | pass)); say "${a[*]}:${b[*]}"',
  'declare -A a=([key]=old); declare -A a+=([key]=new) b=([key]=$(say hi | pass)); say "${a[*]}:${b[*]}"',
  'a=(old); declare -a a+=(new) b=($(say hi | pass)); say "${a[*]}:${b[*]}"',
];

// Bash 3 on macOS lacks associative arrays and declaration compound +=.
// Compare the indexed append with its equivalent standalone assignment.
for (const source of cases) {
  test(`sync declaration completion matches bash: ${source}`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const associative = source.includes("declare -A");
    const native = associative ? undefined : spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source.replaceAll("say ", "printf '%s\\n' ").replaceAll(" | pass", " | cat").replaceAll("declare -a a+=(new)", "a+=(new); declare -a")], { env: { LC_ALL: "C" } });
    if (native) assert.equal(native.status, 0, native.stderr.toString());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const expected = associative
      ? source.includes("a+=") ? "new:hi\n" : "pipe=0 status=0\n"
      : native!.stdout.toString();
    assert.equal(result.stdout, expected);
  });
}

for (const declaration of ["declare", "typeset", "local"]) {
  test(`${declaration} fallback appends once and restores function locals`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`a=(outer); f() { ${declaration} -a a=(old); ${declaration} -a a+=(new) b=($(say hi | pass)); say "\${a[*]}:\${b[*]}"; }; f; say "\${a[*]}:\${b-unset}"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "old new:hi\nouter:unset\n");
  });
}

test("lazy indexed PIPESTATUS publishes synchronously into an active store", async () => {
  const scope = new InvocationScope();
  const raw = new RootShellState("/", Object.create(null) as Record<string, string>, new Set(), undefined);
  const state = trackState(raw, { limits: { maxExpansionBytes: Infinity, maxExpansionFields: Infinity } }, scope);
  const signal = new AbortController().signal;
  try {
    const store = requireArrays(state);
    stateMonitor(state)!.lazyPipeStatus = [1];
    assert.equal(store.get("PIPESTATUS"), undefined);
    const pending = publishPipelineStatus(state, [0], signal, scope);
    await pending;
    assert.equal(pending, undefined);
    assert.equal(store.get("PIPESTATUS")?.getValue(0), "0");
  } finally {
    await scope.close();
  }
  assert.deepEqual(scope.failures, []);
});
