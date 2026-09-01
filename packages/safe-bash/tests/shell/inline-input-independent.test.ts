import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ShellLimitError } from "../../src/shell/index.js";
import { runVirtualScript } from "../shell-stress/helpers.js";
import { isolatedSpawn } from "../shell-stress/process.js";
import { setup } from "./helpers.js";

test("case syntax inside a document substitution is parsed structurally", async () => {
  const fixture = { name: "case inside heredoc expansion", script: "cat <<EOF\n$(case x in x) printf yes;; esac)\nEOF\n" };
  const actual = await runVirtualScript(fixture);
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout, "yes\n");
  assert.equal(actual.stderr, "");
  assert.deepEqual(actual.files, {});

});

test("independent inline source bytes reject before acquiring input", async () => {
  for (const script of ["pass <<EOF\né\nEOF\n", "pass <<<é"]) {
    const { shell, fs } = setup();
    let acquired = 0;
    const stdin = { [Symbol.asyncIterator](): AsyncIterator<Uint8Array> { acquired++; throw new Error("unexpected stdin acquisition"); } };
    const bytes = Buffer.byteLength(script);
    await assert.rejects(shell.exec(script, { stdin, limits: { maxSourceBytes: bytes - 1 } }),
      (error) => error instanceof ShellLimitError && error.limit === "maxSourceBytes");
    assert.equal(acquired, 0);
    assert.deepEqual(await fs.readdir("/"), []);
    assert.equal((await shell.exec(script, { limits: { maxSourceBytes: bytes } })).stdout, "é\n");
  }
});

test("independent inline substitutions share exact command and output budgets", async () => {
  for (const script of ["pass <<EOF\n$(say x)\nEOF\n", "pass <<<$(say x)"]) {
    const { shell } = setup();
    for (const [limits, limit] of [
      [{ maxCommands: 1 }, "maxCommands"],
      [{ maxOutputBytes: 3 }, "maxOutputBytes"],
      [{ maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
    ] as const) {
      await assert.rejects(shell.exec(script, { limits }), (error) => error instanceof ShellLimitError && error.limit === limit);
    }
    assert.equal((await shell.exec(script, { limits: { maxCommands: 2, maxOutputBytes: 4, maxSubstitutionDepth: 1 } })).stdout, "x\n");
    assert.equal((await shell.exec(script)).exitCode, 0);
  }
});

test("active input cancellation during inline substitution has a hard process deadline", async () => {
  const code = `
    import assert from 'node:assert/strict';
    import { setup } from './tests/shell/helpers.ts';
    for (const redirect of ['<<EOF\\n$(read -r value)\\nEOF\\n', '<<<"$(read -r value)"\\n']) {
      const { shell, fs } = setup();
      const controller = new AbortController();
      const reason = new Error('cancel active inline read');
      let reads = 0;
      let returned = 0;
      let rejectRead;
      const stdin = { [Symbol.asyncIterator]() { return {
        next() {
          reads++;
          setTimeout(() => controller.abort(reason), 15);
          return new Promise((_resolve, reject) => { rejectRead = reject; });
        },
        async return() { returned++; return { done: true }; },
      }; } };
      await assert.rejects(shell.exec('pass ' + redirect + 'say bad >marker', { stdin, signal: controller.signal }), error => error === reason);
      rejectRead(new Error('late read rejection'));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reads, 1);
      assert.equal(returned, 1);
      assert.deepEqual(await fs.readdir('/'), []);
    }
    console.log('active inline reads cancelled cleanly');
  `;
  const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "-e", code], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 5000, maxBuffer: 16384,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.toString(), "");
  assert.equal(result.stdout.toString(), "active inline reads cancelled cleanly\n");
});
