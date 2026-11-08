import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts";
import { createOpensslCommand, type OpensslCommandsOptions } from "./index.js";
import { ecdsaRaw } from "./keys.js";

const openssl = process.env.OPENSSL_TEST_BINARY ?? (process.platform === "darwin" ? "/opt/homebrew/opt/openssl@3/bin/openssl" : "openssl");

async function run(args: string[], input: Uint8Array = new Uint8Array(), options: OpensslCommandsOptions = {}) {
  const chunks: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context = {
    args, cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () { yield input; })(),
    stdout: { async write(chunk: Uint8Array) { chunks.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk: Uint8Array) { errors.push(new Uint8Array(chunk)); } },
  } as unknown as CommandContext;
  const result = await createOpensslCommand(options).execute(context);
  return { exitCode: result.exitCode, output: Buffer.concat(chunks), error: Buffer.concat(errors).toString() };
}

for (const args of [["genrsa", "-traditional", "512"], ["ecparam", "-name", "prime256v1", "-genkey", "-noout"]]) {
  test(`review: reads native private DER from ${args[0]}`, async () => {
    const pem = execFileSync(openssl, args, { stdio: ["pipe", "pipe", "pipe"] });
    const der = Buffer.from(pem.toString().split("\n").filter(line => !line.startsWith("---")).join(""), "base64");
    const actual = await run(["pkey", "-inform", "DER", "-pubout"], der);
    assert.equal(actual.exitCode, 0, `${args.join(" ")}: ${actual.error}`);
    assert.deepEqual(actual.output, execFileSync(openssl, ["pkey", "-inform", "DER", "-pubout"], { input: der }));
  });
}

test("review: encryption interoperates with native for supported AES modes and password sources", async () => {
  const message = Buffer.from("secret message\n");
  for (const cipher of ["-aes-128-cbc", "-aes-256-cbc", "-aes-256-ctr"]) {
    for (const derivation of [[], ["-pbkdf2", "-iter", "100"]]) {
      const args = ["enc", cipher, "-S", "0123456789abcdef", "-pass", "pass:secret", ...derivation];
      const expected = execFileSync(openssl, args, { input: message, stdio: ["pipe", "pipe", "pipe"] });
      const encrypted = await run(args, message);
      assert.equal(encrypted.exitCode, 0, encrypted.error);
      assert.deepEqual(encrypted.output, expected);
      const decrypted = await run([...args, "-d"], expected);
      assert.equal(decrypted.exitCode, 0, decrypted.error);
      assert.deepEqual(decrypted.output, message);
    }
  }
  const encrypted = await run(["enc", "-aes-256-cbc", "-pass", "stdin"], Buffer.from("secret\nsecret message\n"));
  assert.equal(encrypted.exitCode, 0, encrypted.error);
  assert.deepEqual(execFileSync(openssl, ["enc", "-d", "-aes-256-cbc", "-pass", "pass:secret"], { input: encrypted.output, stdio: ["pipe", "pipe", "pipe"] }), message);
});

test("review: encryption enforces configured password limit", async () => {
  const actual = await run(["enc", "-aes-256-cbc", "-pass", "pass:12345"], Buffer.from("data"), { limits: { maxPasswordBytes: 4 } });
  assert.equal(actual.exitCode, 1);
  assert.match(actual.error, /password.*size/);
});

test("review: password hashes match native for empty and UTF8 passwords", async () => {
  for (const mode of ["-1", "-apr1", "-5", "-6"]) {
    for (const password of mode === "-1" || mode === "-apr1" ? ["", "ąßé"] : ["ąßé"]) {
      const args = ["passwd", mode, "-salt", "salt", password];
      const actual = await run(args);
      assert.equal(actual.exitCode, 0, actual.error);
      assert.deepEqual(actual.output, execFileSync(openssl, args));
    }
  }
});

test("review: ECDSA rejects negative and noncanonical signature integers", () => {
  for (const encoded of ["3006020180020101", "300702020001020101", "30050200020101"]) {
    assert.throws(() => ecdsaRaw(Buffer.from(encoded, "hex"), 32), /invalid signature/);
  }
});

test("review: passwd honors SHA crypt rounds salt prefix", async () => {
  const args = ["passwd", "-5", "-salt", "rounds=1000$salt", "password"];
  const actual = await run(args);
  assert.equal(actual.exitCode, 0, actual.error);
  assert.deepEqual(actual.output, execFileSync(openssl, args));
});
