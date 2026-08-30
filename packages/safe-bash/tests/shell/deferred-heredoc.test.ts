import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createStandardCommands } from "../../src/commands/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const evidence = JSON.parse(readFileSync(new URL("./deferred-heredoc-reference.json", import.meta.url), "utf8")) as { records: { name: string; source: string; stdout: string; stderr: string; exitCode: number; files: Record<string, string> }[] };
for (const { name, source, ...expected } of evidence.records) {
  test(`frozen GNU 5.3 deferred heredoc: ${name}`, async () => {
    const { shell, fs, commands } = setup();
    for (const command of createStandardCommands()) commands.register(command);
    const result = await shell.exec(source, { env: { LC_ALL: "C", LANG: "C" } });
    const files = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) => [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, files }, expected);
  });
}

test("deferred heredoc retains source and cumulative expansion limits", async () => {
  for (const [source, limits, limit] of [
    ["false && pass <<EOF\n${bad!}\nEOF", { maxSourceBytes: 12 }, "maxSourceBytes"],
    ["pass <<EOF\n$VALUE$VALUE\nEOF", { maxExpansionBytes: 5 }, "maxExpansionBytes"],
    ["pass <<EOF\n$(say child)\nEOF", { maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
    ["pass <<EOF\n$(say child)\nEOF", { maxCommands: 1 }, "maxCommands"],
  ] as const) {
    const { shell } = setup();
    await assert.rejects(shell.exec(source, { env: { VALUE: "abc" }, limits }),
      (error) => error instanceof ShellLimitError && error.limit === limit);
  }
});

test("deferred heredoc keeps parser nesting bounded before redirected execution", async () => {
  const nested = "$(say ".repeat(65) + "value" + ")".repeat(65);
  const { shell, fs } = setup();
  const result = await shell.exec(`say before >before; pass <<EOF\n${nested}\nEOF\nsay after >after`);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /nesting exceeds 64/u);
  assert.equal(result.stdout, "");
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["before"]);
});

test("deferred heredoc cancellation retains earlier effects and stops later expansion", { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel deferred heredoc expansion");
  shell.register({ name: "blocked", execute() { controller.abort(reason); return new Promise(() => undefined); } });
  await assert.rejects(shell.exec("say before >before; pass <<EOF\n$(blocked) $(say wrong >wrong)\nEOF\nsay after >after", { signal: controller.signal }), (error) => error === reason);
  assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["before"]);
});

test("deferred nested heredoc warnings remain visible only when executed", async () => {
  const { shell } = setup();
  const document = "<<OUTER\n`pass <<INNER\nbody`\nOUTER\n";
  const executed = await shell.exec(`pass ${document}`);
  assert.equal(executed.exitCode, 0);
  assert.equal(executed.stdout, "body\n");
  assert.match(executed.stderr, /warning: here-document.*end-of-file.*INNER/u);
  const skipped = await shell.exec(`false && pass ${document}true`);
  assert.deepEqual([skipped.exitCode, skipped.stdout, skipped.stderr], [0, "", ""]);
});

test("deferred body iteration yields to timer cancellation", { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel body iteration");
  const timer = setTimeout(() => controller.abort(reason), 1);
  try {
    await assert.rejects(shell.exec(`say before >before; pass <<EOF\n${"$VALUE".repeat(8192)}\nEOF\nsay after >after`, { env: { VALUE: "value" }, signal: controller.signal }), (error) => error === reason);
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), ["before"]);
  } finally { clearTimeout(timer); }
});
