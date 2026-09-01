import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

for (const [source, expected] of [
  ["VALUE='  a  b *\n'; pass <<<$VALUE", "  a  b *\n\n"],
  ["IFS=:; VALUE='a::b'; pass <<<$VALUE", "a::b\n"],
  ["pass <<<$(say ' a  b * ')", " a  b * \n"],
  ["pass <<<${MISSING:- a  b * }", " a  b * \n"],
  ["set -- a '' b; IFS=; pass <<<$@; pass <<<$*", "a  b\na  b\n"],
] as const) {
  test(`modern here-string scalar does not split or glob: ${source}`, async () => {
    const { shell, fs } = setup();
    await fs.writeFile("/entry", new Uint8Array());
    const result = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [source, status] of [
  ["say ran >marker; pass <<<", 2],
  ["say ran >marker; pass <<< >out", 2],
  ["say ran >marker; false && pass <<<$(true |)", 127],
  ["say ran >marker; pass <<<${bad", 2],
  ["say ran >marker; pass 256<<<word", 2],
] as const) {
  test(`malformed here-string rejects before effects: ${source}`, async () => {
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readdir("/"), []);
  });
}

test("here-string budgets include its appended newline and nested work", async () => {
  for (const [source, limits, limit] of [
    ["pass <<<word", { maxSourceBytes: 4 }, "maxSourceBytes"],
    ["pass <<<1234", { maxExpansionBytes: 4 }, "maxExpansionBytes"],
    ["pass <<<''", { maxExpansionBytes: 0 }, "maxExpansionBytes"],
    ["pass <<<''", { maxExpansionFields: 0 }, "maxExpansionFields"],
    ["pass <<<$(say word)", { maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
    ["pass <<<$(say word)", { maxCommands: 1 }, "maxCommands"],
    ["pass <<<1234", { maxOutputBytes: 4 }, "maxOutputBytes"],
  ] as const) {
    const { shell } = setup();
    await assert.rejects(shell.exec(source, { limits, signal: AbortSignal.timeout(2000) }),
      (error) => error instanceof ShellLimitError && error.limit === limit);
  }
  const { shell } = setup();
  assert.equal((await shell.exec("pass <<<1234", { limits: { maxExpansionBytes: 5 } })).stdout, "1234\n");
});

test("here-string substitutions retain the UTF-8 and NUL string boundary", async () => {
  const { shell } = setup();
  const result = await shell.exec("pass <<<$(bytes)");
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("�é�\n"));
});

test("here-string cancellation observes late host rejection", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel here-string");
  let rejectHost!: (error: Error) => void;
  shell.register({ name: "blocked", execute() {
    controller.abort(reason);
    return new Promise((_resolve, reject) => { rejectHost = reject; });
  } });
  await assert.rejects(shell.exec("pass <<<$(blocked)", { signal: controller.signal }), (error) => error === reason);
  rejectHost(new Error("late host rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("here-string redirection expansion errors preserve ordinary fatal-expansion scope", async () => {
  for (const expansion of ["${VALUE:?stop}", "$((1/0))"]) {
    const { shell, fs } = setup();
    const result = await shell.exec(`pass 2>errors <<<"${expansion}"; status=$?; say after >marker; exit "$status"`);
    assert.equal(result.exitCode, expansion.startsWith("${") ? 127 : 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name).sort(), ["errors", "marker"]);
  }
});
