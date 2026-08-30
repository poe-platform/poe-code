import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ShellLimitError } from "../../src/shell/index.js";
import { isolatedSpawn } from "../shell-stress/process.js";
import { setup } from "./helpers.js";

test("inline-input expansion measures UTF-8 bytes including terminal LF", async () => {
  for (const source of ["pass <<EOF\néé\nEOF\n", "pass <<<éé"]) {
    const { shell } = setup();
    await assert.rejects(shell.exec(source, { limits: { maxExpansionBytes: 4 } }),
      (error) => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    assert.equal((await shell.exec(source, { limits: { maxExpansionBytes: 5 } })).stdout, "éé\n");
  }
});

test("large literal bodies remain source-bounded even when skipped", async () => {
  const { shell } = setup();
  const body = "\t \" ${bad * ) #\n".repeat(16384);
  const source = `false && pass <<'EOF'\n${body}EOF\ntrue`;
  assert.equal((await shell.exec(source, { limits: { maxExpansionBytes: 5 } })).exitCode, 0);
  await assert.rejects(shell.exec(source, { limits: { maxSourceBytes: 1024 } }),
    (error) => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
});

test("inline-input nested parsing retains its bound at the expansion boundary", async () => {
  const nested = "$(say ".repeat(65) + "x" + ")".repeat(65);
  for (const input of [`<<EOF\n${nested}\nEOF\n`, `<<<${nested}`]) {
    const { shell, fs } = setup();
    const result = await shell.exec(`say ran >marker; pass ${input}`);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /nesting exceeds 64/u);
    assert.equal(result.stdout, "");
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), input.startsWith("<<<") ? [] : ["marker"]);
    if (!input.startsWith("<<<")) assert.equal(new TextDecoder().decode(await fs.readFile("/marker")), "ran\n");
  }
});

test("inline-input loops, broken pipes, and timer cancellation have hard child deadlines", async () => {
  const code = `
    import assert from 'node:assert/strict';
    import { setup } from './tests/shell/helpers.ts';
    import { ShellLimitError } from './src/shell/index.ts';
    import { writeBytes } from './src/contracts/index.ts';
    for (const redirect of ["<<<word", "<<EOF\\nword\\nEOF\\n"]) {
      const { shell } = setup();
      await assert.rejects(shell.exec('while true; do pass ' + redirect + '\\ndone', { limits: { maxLoopIterations: 3 } }),
        error => error instanceof ShellLimitError && error.limit === 'maxLoopIterations');
      const controller = new AbortController();
      const reason = new Error('cancel busy inline-input loop');
      const timer = setTimeout(() => controller.abort(reason), 20);
      try {
        await assert.rejects(shell.exec('while true; do : ' + redirect + '\\ndone', {
          signal: controller.signal, limits: { maxLoopIterations: 1000000, maxCommands: 1000000 },
        }), error => error === reason);
      } finally { clearTimeout(timer); }
      shell.register({ name: 'producer', async execute({ stdout, signal }) {
        while (true) await writeBytes(stdout, new Uint8Array(64), signal);
      } });
      const result = await shell.exec('set -o pipefail; producer | pass ' + redirect, {
        signal: AbortSignal.timeout(2000), limits: { pipeHighWaterMark: 1 },
      });
      assert.equal(result.stdout, 'word\\n');
      assert.equal(result.exitCode, 141);
    }
    console.log('inline-input lifecycle passed');
  `;
  const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "-e", code], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 5000, maxBuffer: 262144,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.toString(), "");
  assert.match(result.stdout.toString(), /inline-input lifecycle passed/u);
});
