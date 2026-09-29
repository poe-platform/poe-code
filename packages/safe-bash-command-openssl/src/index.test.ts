import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts";
import { createOpensslCommand, settings } from "./index.js";

async function runOpenssl(
  fs: FileSystem,
  args: string[],
  stdinText = "",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cmd = createOpensslCommand();
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const stdinBytes = new TextEncoder().encode(stdinText);
  const ctx = {
    args,
    cwd: "/",
    env: {},
    fs,
    signal: new AbortController().signal,
    stdin: (async function* () {
      if (stdinBytes.byteLength > 0) yield stdinBytes;
    })(),
    stdout: {
      async write(chunk: Uint8Array) {
        stdoutChunks.push(new Uint8Array(chunk));
      },
    },
    stderr: {
      async write(chunk: Uint8Array) {
        stderrChunks.push(new Uint8Array(chunk));
      },
    },
  } as unknown as CommandContext;

  const res = await cmd.execute(ctx);
  const concat = (arr: Uint8Array[]) => {
    const len = arr.reduce((a, b) => a + b.byteLength, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const c of arr) {
      out.set(c, off);
      off += c.byteLength;
    }
    return new TextDecoder().decode(out);
  };
  return {
    exitCode: res.exitCode,
    stdout: concat(stdoutChunks),
    stderr: concat(stderrChunks),
  };
}

test("openssl command definition exports standard contract and settings", () => {
  const def = createOpensslCommand();
  assert.equal(def.name, "openssl");
  assert.equal(typeof def.execute, "function");
  assert.equal(settings().maxBufferedBytes, Infinity);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxBufferedBytes: value }).maxBufferedBytes, value);
    assert.equal(settings({ limits: { maxBufferedBytes: value } }).maxBufferedBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) {
    assert.throws(() => settings({ maxBufferedBytes: value }), RangeError);
  }
});

test("openssl dgst, rand, base64, enc -aes-256-cbc -pbkdf2, genpkey/pkey, and req/x509", async () => {
  const fs = createMemoryFileSystem();

  const ver = await runOpenssl(fs, ["version"]);
  assert.equal(ver.exitCode, 0);
  assert.match(ver.stdout, /OpenSSL 3\.3\.2/);

  const randHex = await runOpenssl(fs, ["rand", "-hex", "16"]);
  assert.equal(randHex.exitCode, 0);
  assert.equal(randHex.stdout.trim().length, 32);

  await fs.writeFile("/msg.txt", new TextEncoder().encode("abc"));
  const dgst = await runOpenssl(fs, ["dgst", "-sha256", "/msg.txt"]);
  assert.equal(dgst.exitCode, 0);
  assert.match(dgst.stdout, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/);

  const hmac = await runOpenssl(fs, ["dgst", "-sha256", "-hmac", "secret", "/msg.txt"]);
  assert.equal(hmac.exitCode, 0);
  assert.match(hmac.stdout, /HMAC-SHA2-256/);

  await fs.writeFile("/plain.txt", new TextEncoder().encode("top secret payload 12345\n"));
  const enc = await runOpenssl(fs, [
    "enc",
    "-aes-256-cbc",
    "-pbkdf2",
    "-pass",
    "pass:my-secret-pw",
    "-in",
    "/plain.txt",
    "-out",
    "/cipher.enc",
    "-a",
  ]);
  assert.equal(enc.exitCode, 0);

  const dec = await runOpenssl(fs, [
    "enc",
    "-aes-256-cbc",
    "-d",
    "-pbkdf2",
    "-pass",
    "pass:my-secret-pw",
    "-in",
    "/cipher.enc",
    "-out",
    "/decrypted.txt",
    "-a",
  ]);
  assert.equal(dec.exitCode, 0);
  assert.equal(
    new TextDecoder().decode(await fs.readFile("/decrypted.txt")),
    "top secret payload 12345\n",
  );

  const gen = await runOpenssl(fs, ["genpkey", "-algorithm", "ED25519", "-out", "/ed25519.pem"]);
  assert.equal(gen.exitCode, 0);
  const pub = await runOpenssl(fs, ["pkey", "-in", "/ed25519.pem", "-pubout", "-out", "/ed25519.pub.pem"]);
  assert.equal(pub.exitCode, 0);
  const pubText = new TextDecoder().decode(await fs.readFile("/ed25519.pub.pem"));
  assert.match(pubText, /-----BEGIN PUBLIC KEY-----/);

  const reqRes = await runOpenssl(fs, [
    "req",
    "-x509",
    "-keyout",
    "/tls.key",
    "-out",
    "/tls.crt",
    "-subj",
    "/CN=git.example.com",
  ]);
  assert.equal(reqRes.exitCode, 0);
  const x509Res = await runOpenssl(fs, [
    "x509",
    "-in",
    "/tls.crt",
    "-noout",
    "-subject",
    "-issuer",
    "-fingerprint",
  ]);
  assert.equal(x509Res.exitCode, 0);
  assert.match(x509Res.stdout, /subject=\/CN=git\.example\.com/);
  assert.match(x509Res.stdout, /sha256 Fingerprint=/);
});
