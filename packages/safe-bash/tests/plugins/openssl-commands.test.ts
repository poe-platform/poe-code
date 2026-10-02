import assert from "node:assert/strict";
import test from "node:test";
import { X509Certificate } from "node:crypto";
import { Shell, createMemoryFileSystem, opensslCommands, createAgentCommands, createOpensslCommand } from "../../src/index.js";
import { createOpensslCommand as subpathFactory } from "../../src/commands/openssl/index.js";

test("openssl public command is registered once and runs VFS pipelines", async () => {
  assert.equal(createOpensslCommand, subpathFactory);
  assert.equal(createAgentCommands().filter(command => command.name === "openssl").length, 1);
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(opensslCommands());
  try {
    const encoded = await shell.exec("openssl base64 -A | openssl base64 -d -A > /payload", { stdin: Uint8Array.of(0, 255, 65, 10) });
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.deepEqual(await fs.readFile("/payload"), Uint8Array.of(0, 255, 65, 10));
    const hash = await shell.exec("openssl sha256 -binary /payload | openssl base64 -A");
    assert.equal(hash.exitCode, 0, hash.stderr);
    assert.equal(Buffer.from(hash.stdout, "base64").length, 32);
    const crypt = await shell.exec("PW=secret openssl enc -aes-256-ctr -pass env:PW -pbkdf2 -iter 2 -in /payload -out /encrypted");
    assert.equal(crypt.exitCode, 0, crypt.stderr);
    const plain = await shell.exec("openssl enc -aes-256-ctr -d -pass pass:secret -pbkdf2 -iter 2 -in /encrypted");
    assert.equal(plain.exitCode, 0, plain.stderr);
    assert.deepEqual(plain.stdoutBytes, Uint8Array.of(0, 255, 65, 10));
  } finally { await shell.dispose(); }
});

test("openssl certificate workflow preserves key identity and propagates checkend status", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(opensslCommands());
  try {
    for (const command of [
      "openssl ecparam -name prime256v1 -genkey -out /key",
      "openssl req -new -x509 -nodes -key /key -days 1 -subj /CN=shell.example -addext subjectAltName=DNS:shell.example -out /cert",
      "openssl x509 -in /cert -noout -subject -dates",
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const certificate = new X509Certificate(await fs.readFile("/cert"));
    assert.equal(certificate.verify(certificate.publicKey), true);
    const check = await shell.exec("openssl x509 -in /cert -checkend 172800 -noout");
    assert.equal(check.exitCode, 1);
    assert.equal(check.stdout, "Certificate will expire\n");
  } finally { await shell.dispose(); }
});
