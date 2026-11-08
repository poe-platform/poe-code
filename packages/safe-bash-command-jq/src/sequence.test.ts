import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const input of [
  "\x1e1",
  "\x1e1\x1e2\n",
  "\x1e1\n\x1e2\n",
  "\x1e{}\n\x1e3",
  "\x1e{}\n\x1e3\n",
  "\x1e{}\x1e3",
  "\x1e{}\n \x1e3",
  "\x1e{}\n\x1e3\x1e4",
  "\x1e{}\n\x1e{}",
  "\x1e{}\n3",
  '\x1e{\n  "name": "fixture"\n}\n\x1e3',
]) {
  for (const flags of [[], ["--slurp"], ["--stream"], ["--stream", "--stream-errors"]]) {
    test(`jq numeric sequence matches native jq: ${JSON.stringify(input)}, ${flags.join(" ")}`, async () => {
      const args = ["-c", "--seq", ...flags, "."];
      const native = spawnSync("jq", args, { input, encoding: "utf8" });
      assert.equal(native.error, undefined);
      assert.equal(native.signal, null);
      for (const source of [input, (async function* () {
        for (const byte of Buffer.from(input)) yield Uint8Array.of(byte);
      })()]) {
        const result = await run(args, source);
        assert.deepEqual(
          { stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
          { stdout: native.stdout, stderr: native.stderr, status: native.status },
        );
      }
    });
  }
}

for (const input of ["{}", "{}\n", "", " \t\n", "\x1e{}\n", "ignored\x1e{}\n", "\x1e{bad}\n"]) {
  test(`jq sequence framing matches native jq: ${JSON.stringify(input)}`, async () => {
    const args = ["-c", "--seq", "."];
    const native = spawnSync("jq", args, { input, encoding: "utf8" });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    for (const source of [input, (async function* () {
      for (const byte of Buffer.from(input)) yield Uint8Array.of(byte);
    })()]) {
      const result = await run(args, source);
      assert.deepEqual(
        { stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: native.stdout, stderr: native.stderr, status: native.status },
      );
    }
  });
}

for (const filter of ["[inputs|.name]", "try [inputs|.name] catch .", "input, try input catch .", ".name", "if false then inputs else .name end"]) {
  test(`jq sequence malformed records preserve input error handling: ${filter}`, async () => {
    const input = '\x1e{"name":"safe-bash-command-zip"}\n\x1e{"bad":]\n\x1e{"ok":true}\n';
    const args = ["--seq", "-c", ...(filter.includes("inputs else") || filter === ".name" ? [] : ["-n"]), filter];
    const native = spawnSync("jq", args, { input, encoding: "utf8" });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    for (const source of [input, (async function* () {
      for (const byte of Buffer.from(input)) yield Uint8Array.of(byte);
    })()]) {
      const result = await run(args, source);
      assert.deepEqual(
        { stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
        { stdout: native.stdout, stderr: native.stderr, status: native.status },
      );
    }
  });
}

for (const partial of ["[", "[1,", "[1", "[1 ", "[[", "{", '{"a":', '{"a":1,']) {
  for (const flags of [[], ["--stream"], ["--stream-errors"]]) {
    test(`jq sequence interrupted containers match native jq: ${partial}, ${flags.join(" ")}`, async () => {
      const input = `\x1e{"name":"safe-bash-command-jq"}\n\x1e${partial}\x1e{"ok":true}\n`;
      const args = ["--seq", "-c", ...flags, flags.length ? "." : "type"];
      const native = spawnSync("jq", args, { input, encoding: "utf8" });
      assert.equal(native.error, undefined);
      assert.equal(native.signal, null);
      for (const source of [input, (async function* () {
        for (const byte of Buffer.from(input)) yield Uint8Array.of(byte);
      })()]) {
        const result = await run(args, source);
        assert.deepEqual(
          { stdout: result.stdout, stderr: result.stderr, status: result.exitCode },
          { stdout: native.stdout, stderr: native.stderr, status: native.status },
        );
      }
    });
  }
}
