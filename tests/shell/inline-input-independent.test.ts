import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ShellLimitError } from "../../src/shell/index.js";
import { bashVersion, runBash, runVirtualScript } from "../shell-stress/helpers.js";
import { isolatedSpawn } from "../shell-stress/process.js";
import { setup } from "./helpers.js";

const cases = [
  ["quoted dollar and backslash", 'VALUE=hi; cat <<"E\\$OF"\n$VALUE \\n\nE$OF\n'],
  ["single quoted slash delimiter", "VALUE=hi; cat <<'E\\OF'\n$VALUE\nE\\OF\n"],
  ["empty delimiter", "VALUE=hi; cat <<''\n$VALUE\n\nprintf done"],
  ["unquoted continuation before tab strip", "cat <<-EOF\n\tone\\\n\t two\n\tEOF\n"],
  ["quoted continuation before tab strip", "cat <<-'EOF'\n\tone\\\n\t two\n\tEOF\n"],
  ["literal command shaped delimiter", "VALUE=hi; cat <<$(printf 'EOF')\n$VALUE\n$(printf EOF)\n"],
  ["literal parameter shaped delimiter", "VALUE=hi; cat <<${x:-'EOF'}\n$VALUE\n${x:-EOF}\n"],
  ["FIFO documents before comment", "cat <<A 3<<B # comment\none\nA\ntwo\nB\n"],
  ["heredoc inside case clause", "case x in x) cat <<EOF\n$(printf yes)\nEOF\n;; esac"],
  ["quoted document inside substitution", "value=$(cat <<'EOF'\nhi\nEOF\n); printf '<%s>' \"$value\""],
  ["document inside backticks", "value=`cat <<EOF\nhi\nEOF\n`; printf '<%s>' \"$value\""],
  ["FIFO across pipeline", "cat <<A | cat <<B\none\nA\ntwo\nB\n"],
  ["FIFO across statements", "cat <<A; cat <<B\none\nA\ntwo\nB\n"],
  ["delimiter without final newline", "cat <<EOF\nhi\nEOF"],
  ["empty body without final newline", "cat <<EOF\nEOF"],
  ["protected delimiter text", "cat <<EOF\n\\EOF\nEOF\n"],
  ["paired backslash before newline", "cat <<EOF\na\\\\\nEOF\n"],
  ["escaped command substitution has no effects", "cat <<EOF\n\\$(printf bad >marker)\nEOF\n"],
  ["space then tab survives stripping", 'cat <<-"EOF"\n \tspace\n\tEOF\n'],
  ["here-string early read retains descriptor cursor", "{ read -r first <&3; cat <&4; printf '<%s>' \"$first\"; } 3<<<'one\ntwo' 4<&3"],
  ["redirected pipe retains upstream file effects", "printf upstream >out | cat <<EOF\ndownstream\nEOF\ncat out"],
  ["loop condition consumes shared document", "while read -r word; do printf '<%s>' \"$word\"; done <<EOF\none\ntwo\nEOF\n"],
] as const;

for (const [name, script] of cases) {
  test(`independent inline-input differential: ${name}`, async () => {
    const fixture = { name, script };
    assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
  });
}

test("case syntax inside a document substitution is parsed structurally", async (context) => {
  const fixture = { name: "case inside heredoc expansion", script: "cat <<EOF\n$(case x in x) printf yes;; esac)\nEOF\n" };
  const actual = await runVirtualScript(fixture);
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout, "yes\n");
  assert.equal(actual.stderr, "");
  assert.deepEqual(actual.files, {});
  const reference = await runBash(fixture);
  if (bashVersion().includes("version 3.2.")) {
    assert.equal(reference.exitCode, 0);
    assert.equal(reference.stdout, " printf yes;; esac)\n");
    assert.match(reference.stderr, /syntax error/u);
    assert.deepEqual(reference.files, {});
    context.diagnostic("Bash 3.2 misparses the unparenthesized case pattern inside this document substitution; not treated as desired syntax.");
  } else assert.deepEqual(actual, reference);
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
