import assert from "node:assert/strict";
import test from "node:test";
import { chunks, fixture, run } from "./helpers.js";

test("cut field selection preserves invalid UTF-8 and NUL bytes", async () => {
  const stdin = Uint8Array.of(65, 58, 255, 128, 0, 58, 66, 10);
  for (const width of [1, 2, 3, 64]) {
    const result = await run("cut", ["-d", ":", "-f", "2"], { stdin: chunks(stdin, width) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Buffer.from([255, 128, 0, 10]));
  }
});

test("cut joins selected byte fields including empty fields and custom delimiters", async () => {
  const result = await run("cut", ["-d", ":", "-f", "1,3,4", "--output-delimiter=|"], {
    stdin: Uint8Array.of(255, 58, 65, 58, 58, 128, 10),
  });
  assert.deepEqual(result.stdoutBytes, Buffer.from([255, 124, 124, 128, 10]));
});

test("cut keeps UTF-8 delimiter support without decoding the selected payload", async () => {
  const stdin = Buffer.concat([Buffer.from("lefté"), Buffer.from([255]), Buffer.from("éright\n")]);
  const result = await run("cut", ["-d", "é", "-f", "2"], { stdin });
  assert.deepEqual(result.stdoutBytes, Buffer.from([255, 10]));
});

test("grep only-matching preserves selected bytes rather than replacement characters", async () => {
  for (const width of [1, 2, 64]) {
    const result = await run("grep", ["-ao", "."], { stdin: chunks(Uint8Array.of(255, 128, 10), width), env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Buffer.from([255, 10, 128, 10]));
  }
});

test("grep fixed strings preserve valid UTF-8 literals in byte mode", async () => {
  const result = await run("grep", ["-Fo", "é"], { stdin: chunks("préfixe é\n"), env: { LC_ALL: "C" } });
  assert.equal(result.stdout, "é\né\n");
  assert.equal(result.exitCode, 0);
});

test("grep pattern files retain invalid byte patterns", async () => {
  const fs = await fixture({ patterns: Uint8Array.of(255, 10) });
  const result = await run("grep", ["-Fof", "patterns"], { fs, stdin: Uint8Array.of(128, 255, 10) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Buffer.from([255, 10]));
});
