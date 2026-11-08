import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { X509Certificate, verify as nativeVerify, sign as nativeSign } from "node:crypto";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts";
import { createOpensslCommand, settings } from "./index.js";

const nativeOpenssl = process.env.OPENSSL_TEST_BINARY ?? (process.platform === "darwin" ? "/opt/homebrew/opt/openssl@3/bin/openssl" : "openssl");
assert.ok(execFileSync(nativeOpenssl, ["version"], { encoding: "utf8" }).startsWith("OpenSSL 3."), "Differential tests require OpenSSL 3 (OPENSSL_TEST_BINARY may select it)");

async function runOpenssl(
  fs: FileSystem,
  args: string[],
  stdinText = "",
  maxBufferedBytes = Infinity,
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cmd = createOpensslCommand({ maxBufferedBytes });
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const stdinBytes = new TextEncoder().encode(stdinText);
  const ctx = {
    args,
    cwd: "/",
    env,
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
  assert.equal(settings().maxBufferedBytes, 16 * 1024 * 1024);
  for (const value of [Infinity, 16]) {
    assert.equal(settings({ maxBufferedBytes: value }).maxBufferedBytes, value);
    assert.equal(settings({ limits: { maxBufferedBytes: value } }).maxBufferedBytes, value);
  }
  for (const value of [-Infinity, NaN, -1, 0, 1.5]) {
    assert.throws(() => settings({ maxBufferedBytes: value }), RangeError);
  }
});

test("AES ciphers interoperate with native OpenSSL for raw keys, EVP and PBKDF2", async () => {
  const fs = createMemoryFileSystem();
  const payload = new TextEncoder().encode("payload with binary\u0000\u00ff and more than one AES block\n");
  await fs.writeFile("/input", payload);
  for (const cipher of ["-aes-128-cbc", "-aes-256-cbc", "-aes-256-ctr"]) {
    for (const derivation of [
      ["-K", "ab".repeat(cipher === "-aes-128-cbc" ? 16 : 32), "-iv", "cd".repeat(16)],
      ["-k", "password", "-nosalt"],
      ["-pass", "pass:password", "-pbkdf2", "-iter", "25", "-nosalt"],
      ["-pass", "pass:password", "-S", "1122334455667788"],
    ]) {
      const args = ["enc", cipher, ...derivation];
      const expected = execFileSync(nativeOpenssl, args, { input: payload, stdio: ["pipe", "pipe", "pipe"] });
      const encoded = await runOpenssl(fs, [...args, "-in", "/input", "-out", "/cipher"]);
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      assert.deepEqual(await fs.readFile("/cipher"), new Uint8Array(expected), args.join(" "));
      const decoded = await runOpenssl(fs, [...args, "-d", "-in", "/cipher", "-out", "/plain"]);
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(await fs.readFile("/plain"), payload);
    }
  }
});

test("password sources use the invocation environment, VFS and first stdin line", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/password", new TextEncoder().encode("secret\nignored\n"));
  const base = ["enc", "-aes-256-ctr", "-pbkdf2", "-iter", "2", "-nosalt", "-a", "-A"];
  const expected = await runOpenssl(fs, [...base, "-pass", "pass:secret"], "data");
  for (const spec of ["env:PW", "file:/password", "stdin"]) {
    const result = await runOpenssl(fs, [...base, "-pass", spec], spec === "stdin" ? "secret\ndata" : "data", Infinity, { PW: "secret" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected.stdout);
  }
  const missing = await runOpenssl(fs, [...base, "-pass", "env:ABSENT"], "data");
  assert.equal(missing.exitCode, 1);
});

test("certificate PEM/DER conversion and inspection match native OpenSSL", async () => {
  const fs = createMemoryFileSystem();
  const generated = await runOpenssl(fs, ["req", "-new", "-x509", "-nodes", "-newkey", "ec:prime256v1", "-keyout", "/key", "-subj", "/CN=test.example/O=Test", "-days", "3", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "subjectAltName=DNS:test.example", "-out", "/cert"]);
  assert.equal(generated.exitCode, 0, generated.stderr);
  const bytes = await fs.readFile("/cert");
  for (const flags of [["-subject"], ["-issuer"], ["-dates"], ["-startdate"], ["-enddate"], ["-serial"], ["-fingerprint"], ["-fingerprint", "-sha256"], ["-checkend", "1"], ["-checkend", "999999"]]) {
    const actual = await runOpenssl(fs, ["x509", "-in", "/cert", "-noout", ...flags]);
    let expected: string;
    // Select OpenSSL's compact name rendering explicitly across 3.x versions.
    try { expected = execFileSync(nativeOpenssl, ["x509", "-noout", "-nameopt", "sep_comma_plus_space,sname", ...flags], { input: bytes, encoding: "utf8" }); }
    catch (error) { expected = (error as { stdout: string }).stdout; }
    assert.equal(actual.stdout, expected, flags.join(" "));
    assert.equal(actual.exitCode, flags.includes("999999") ? 1 : 0, actual.stderr);
  }
  const ext = await runOpenssl(fs, ["x509", "-in", "/cert", "-noout", "-ext", "subjectAltName,basicConstraints"]);
  assert.equal(ext.exitCode, 0, ext.stderr);
  assert.ok(ext.stdout.includes("test.example"));
  const inspected = await runOpenssl(fs, ["x509", "-in", "/cert", "-noout", "-text"]);
  assert.ok(inspected.stdout.includes("Certificate"));
  assert.equal((await runOpenssl(fs, ["x509", "-in", "/cert", "-outform", "DER", "-out", "/der"])).exitCode, 0);
  const parsed = await runOpenssl(fs, ["x509", "-inform", "DER", "-in", "/der", "-noout", "-subject"]);
  assert.equal(parsed.stdout, "subject=CN=test.example, O=Test\n");
});

test("digest aliases and binary multiple-file output match native OpenSSL", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/one", new TextEncoder().encode("abc"));
  await fs.writeFile("/two", new TextEncoder().encode("def"));
  for (const name of ["md5", "sha1", "sha256", "sha384", "sha512"]) {
    for (const flags of [[], ["-hex"], ["-r"], ["-hmac", "secret"]]) {
      const actual = await runOpenssl(fs, [name, ...flags], "abc");
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stdout, execFileSync(nativeOpenssl, [name, ...flags], { input: "abc", encoding: "utf8" }));
    }
  }
  const result = await runOpenssl(fs, ["dgst", "-sha256", "-binary", "-out", "/hashes", "/one", "/two"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const expected = Buffer.concat(["abc", "def"].map(input => execFileSync(nativeOpenssl, ["dgst", "-sha256", "-binary"], { input })));
  assert.deepEqual(await fs.readFile("/hashes"), new Uint8Array(expected));
});

test("EC generation, DER conversion, signature verification and native public keys", async () => {
  const fs = createMemoryFileSystem();
  for (const curve of ["prime256v1", "secp384r1", "secp521r1"]) {
    const generated = await runOpenssl(fs, ["ecparam", "-name", curve, "-genkey", "-noout", "-out", "/key"]);
    assert.equal(generated.exitCode, 0, generated.stderr);
    const key = await fs.readFile("/key");
    const publicKey = await runOpenssl(fs, ["ec", "-in", "/key", "-pubout"]);
    assert.equal(publicKey.exitCode, 0, publicKey.stderr);
    assert.equal(publicKey.stdout, execFileSync(nativeOpenssl, ["pkey", "-pubout"], { input: key, encoding: "utf8" }));
    assert.equal((await runOpenssl(fs, ["pkey", "-in", "/key", "-outform", "DER", "-out", "/key.der"])).exitCode, 0);
    assert.equal((await runOpenssl(fs, ["pkey", "-inform", "DER", "-in", "/key.der", "-pubout"])).stdout, publicKey.stdout);
    await fs.writeFile("/pub", new TextEncoder().encode(publicKey.stdout));
    assert.equal((await runOpenssl(fs, ["dgst", "-sha256", "-sign", "/key", "-out", "/signature"], "message")).exitCode, 0);
    assert.equal(nativeVerify("sha256", Buffer.from("message"), publicKey.stdout, await fs.readFile("/signature")), true);
    await fs.writeFile("/signature", nativeSign("sha256", Buffer.from("message"), Buffer.from(key)));
    const verified = await runOpenssl(fs, ["dgst", "-sha256", "-verify", "/pub", "-signature", "/signature"], "message");
    assert.equal(verified.exitCode, 0, verified.stderr);
    assert.equal(verified.stdout, "Verified OK\n");
    const generatedCert = await runOpenssl(fs, ["x509", "-new", "-key", "/key", "-subj", "/CN=ec.example", "-days", "1"]);
    assert.equal(generatedCert.exitCode, 0, generatedCert.stderr);
    assert.equal(new X509Certificate(generatedCert.stdout).verify(new X509Certificate(generatedCert.stdout).publicKey), true);
  }
});

test("version flags and stdin password hash modes are functional", async () => {
  const fs = createMemoryFileSystem();
  const all = await runOpenssl(fs, ["version", "-a"]);
  for (const flag of ["-v", "-b", "-o", "-f", "-p", "-d"]) {
    const result = await runOpenssl(fs, ["version", flag]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.trim());
    assert.ok(all.stdout.includes(result.stdout.trim()));
  }
  for (const flag of ["-1", "-5", "-6", "-apr1"]) {
    const args = ["passwd", flag, "-salt", "salt", "-stdin"];
    const actual = await runOpenssl(fs, args, "password\nsecond\n");
    assert.equal(actual.stdout, execFileSync(nativeOpenssl, args, { input: "password\nsecond\n", encoding: "utf8" }));
  }
});

test("native-compatible digests and crypt password hashes", async () => {
  const fs = createMemoryFileSystem();
  for (const args of [["md5"], ["dgst", "-md5", "-hmac", "secret"], ...["-1", "-apr1", "-5", "-6"].map(flag => ["passwd", flag, "-salt", "salt", "password"])]) {
    const expected = execFileSync(nativeOpenssl, args, { input: "abc", encoding: "utf8" });
    const actual = await runOpenssl(fs, args, "abc");
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout, expected, args.join(" "));
  }
});

test("req produces a real signed certificate using the requested key, validity and extensions", async () => {
  const fs = createMemoryFileSystem();
  assert.equal((await runOpenssl(fs, ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:1024", "-out", "/key"])).exitCode, 0);
  const result = await runOpenssl(fs, ["req", "-new", "-x509", "-key", "/key", "-days", "2", "-subj", "/CN=example.test/O=Test", "-addext", "subjectAltName=DNS:example.test,DNS:www.example.test", "-out", "/cert"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const cert = new X509Certificate(await fs.readFile("/cert"));
  assert.equal(cert.verify(cert.publicKey), true);
  assert.equal(Date.parse(cert.validTo) - Date.parse(cert.validFrom), 2 * 86400000);
  assert.equal(cert.subjectAltName, "DNS:example.test, DNS:www.example.test");
  const csr = await runOpenssl(fs, ["req", "-new", "-key", "/key", "-subj", "/CN=example.test"]);
  assert.equal(csr.exitCode, 0, csr.stderr);
  assert.ok(csr.stdout.includes("BEGIN CERTIFICATE REQUEST"));
  assert.ok(execFileSync(nativeOpenssl, ["req", "-verify", "-noout"], { input: csr.stdout, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) !== undefined);
});

test("openssl dgst, rand, base64, enc -aes-256-cbc -pbkdf2, genpkey/pkey, and req/x509", async () => {
  const fs = createMemoryFileSystem();

  const ver = await runOpenssl(fs, ["version"]);
  assert.equal(ver.exitCode, 0);
  assert.ok(ver.stdout.includes("OpenSSL compatible safe-bash toolkit"));

  const randHex = await runOpenssl(fs, ["rand", "-hex", "16"]);
  assert.equal(randHex.exitCode, 0);
  assert.equal(randHex.stdout.trim().length, 32);

  await fs.writeFile("/msg.txt", new TextEncoder().encode("abc"));
  const dgst = await runOpenssl(fs, ["dgst", "-sha256", "/msg.txt"]);
  assert.equal(dgst.exitCode, 0);
  assert.match(dgst.stdout, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/);

  const hmac = await runOpenssl(fs, ["dgst", "-sha256", "-hmac", "secret", "/msg.txt"]);
  assert.equal(hmac.exitCode, 0);
  assert.match(hmac.stdout, /SHA2-256/);

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
  assert.ok(x509Res.stdout.includes("subject=CN=git.example.com"));
  assert.ok(x509Res.stdout.includes("SHA1 Fingerprint="));
});


test("openssl rand fills multiple Web Crypto chunks", async () => {
  const result = await runOpenssl(createMemoryFileSystem(), ["rand", "-hex", "131073"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim().length, 262146);
});

test("openssl bounds pkey and x509 file inputs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/large", new Uint8Array(65));
  for (const command of ["pkey", "x509"]) {
    const result = await runOpenssl(fs, [command, "-in", "/large"], "", 64);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("maximum buffered size of 64 bytes"), result.stderr);
    assert.equal(result.stdout, "");
  }
});

test("openssl supports RSA-2048 genpkey/genrsa, pkey -pubout/-check, and dgst -sign/-verify", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/dossier.pdf", new TextEncoder().encode("%PDF-1.7 signed payload\n"));

  const genRsa = await runOpenssl(fs, [
    "genpkey",
    "-algorithm",
    "RSA",
    "-pkeyopt",
    "rsa_keygen_bits:2048",
    "-out",
    "/rsa-priv.pem",
  ]);
  assert.equal(genRsa.exitCode, 0, genRsa.stderr);
  const privPem = new TextDecoder().decode(await fs.readFile("/rsa-priv.pem"));
  assert.match(privPem, /-----BEGIN PRIVATE KEY-----/);
  assert.ok(privPem.length > 1200, "RSA-2048 PKCS#8 PEM must be > 1200 bytes");

  const checkKey = await runOpenssl(fs, ["pkey", "-in", "/rsa-priv.pem", "-check", "-noout"]);
  assert.equal(checkKey.exitCode, 0, checkKey.stderr);
  assert.match(checkKey.stdout, /Key is valid/);

  const pubRsa = await runOpenssl(fs, ["pkey", "-in", "/rsa-priv.pem", "-pubout", "-out", "/rsa-pub.pem"]);
  assert.equal(pubRsa.exitCode, 0, pubRsa.stderr);
  const pubPem = new TextDecoder().decode(await fs.readFile("/rsa-pub.pem"));
  assert.match(pubPem, /-----BEGIN PUBLIC KEY-----/);
  assert.ok(pubPem.length > 400, "RSA-2048 SPKI PEM must be > 400 bytes");

  const signRes = await runOpenssl(fs, [
    "dgst",
    "-sha256",
    "-sign",
    "/rsa-priv.pem",
    "-out",
    "/dossier.pdf.sig",
    "/dossier.pdf",
  ]);
  assert.equal(signRes.exitCode, 0, signRes.stderr);
  const sigBytes = await fs.readFile("/dossier.pdf.sig");
  assert.equal(sigBytes.byteLength, 256, "RSA-2048 signature must be 256 bytes");
  assert.equal(nativeVerify("sha256", Buffer.from("%PDF-1.7 signed payload\n"), pubPem, sigBytes), true);
  const modulus = await runOpenssl(fs, ["rsa", "-in", "/rsa-priv.pem", "-noout", "-modulus"]);
  assert.equal(modulus.stdout, execFileSync(nativeOpenssl, ["rsa", "-noout", "-modulus"], { input: privPem, encoding: "utf8" }));
  const description = await runOpenssl(fs, ["rsa", "-in", "/rsa-priv.pem", "-noout", "-text"]);
  assert.equal(description.exitCode, 0, description.stderr);
  assert.ok(description.stdout.includes("Private-Key: (2048 bit)"));
  assert.ok(description.stdout.includes("modulus:"));

  const verifyOk = await runOpenssl(fs, [
    "dgst",
    "-sha256",
    "-verify",
    "/rsa-pub.pem",
    "-signature",
    "/dossier.pdf.sig",
    "/dossier.pdf",
  ]);
  assert.equal(verifyOk.exitCode, 0, verifyOk.stderr);
  assert.match(verifyOk.stdout, /Verified OK/);

  await fs.writeFile("/dossier-tampered.pdf", new TextEncoder().encode("%PDF-1.7 tampered payload\n"));
  const verifyFail = await runOpenssl(fs, [
    "dgst",
    "-sha256",
    "-verify",
    "/rsa-pub.pem",
    "-signature",
    "/dossier.pdf.sig",
    "/dossier-tampered.pdf",
  ]);
  assert.equal(verifyFail.exitCode, 1);
  assert.match(verifyFail.stdout + verifyFail.stderr, /Verification Failure/);
});


test("openssl supports Ed25519 signing and verification with pkeyutl", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/payload.txt", new TextEncoder().encode("forensics payload\n"));
  await fs.writeFile("/tampered.txt", new TextEncoder().encode("tampered payload\n"));

  const gen = await runOpenssl(fs, ["genpkey", "-algorithm", "Ed25519", "-out", "/ed-priv.pem"]);
  assert.equal(gen.exitCode, 0, gen.stderr);

  const pub = await runOpenssl(fs, ["pkey", "-in", "/ed-priv.pem", "-pubout", "-out", "/ed-pub.pem"]);
  assert.equal(pub.exitCode, 0, pub.stderr);

  const sign = await runOpenssl(fs, [
    "pkeyutl",
    "-sign",
    "-rawin",
    "-inkey",
    "/ed-priv.pem",
    "-in",
    "/payload.txt",
    "-out",
    "/payload.sig",
  ]);
  assert.equal(sign.exitCode, 0, sign.stderr);

  const verifyOk = await runOpenssl(fs, [
    "pkeyutl",
    "-verify",
    "-rawin",
    "-pubin",
    "-inkey",
    "/ed-pub.pem",
    "-in",
    "/payload.txt",
    "-sigfile",
    "/payload.sig",
  ]);
  assert.equal(verifyOk.exitCode, 0, verifyOk.stderr);
  assert.match(verifyOk.stdout, /Signature Verified Successfully/);

  const verifyFail = await runOpenssl(fs, [
    "pkeyutl",
    "-verify",
    "-rawin",
    "-pubin",
    "-inkey",
    "/ed-pub.pem",
    "-in",
    "/tampered.txt",
    "-sigfile",
    "/payload.sig",
  ]);
  assert.equal(verifyFail.exitCode, 1);
  assert.match(verifyFail.stdout + verifyFail.stderr, /Signature Verification Failure/);
});
