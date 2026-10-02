import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts";
import { createGpgCommand, settings } from "./index.js";

async function runGpg(
  fs: FileSystem,
  args: string[],
  stdinText = "",
  maxBufferedBytes = Infinity,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cmd = createGpgCommand({ maxBufferedBytes });
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

test("gpg command exports standard contract and settings", () => {
  const def = createGpgCommand();
  assert.equal(def.name, "gpg");
  assert.equal(settings().maxBufferedBytes, Infinity);
});

test("gpg rejects unknown options instead of reporting success", async () => {
  const result = await runGpg(createMemoryFileSystem(), ["--unknown-nonexistent-flag"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "gpg: unknown option: --unknown-nonexistent-flag\n");
});

for (const args of [
  ["--unknown-nonexistent-flag"],
  ["--unknown-nonexistent-flag", "--version"],
  ["--version", "--unknown-nonexistent-flag"],
  ["--quick-generate-key", "--unknown-nonexistent-flag", "Alice"],
  ["--detach-sign", "--output", "/output", "--unknown-nonexistent-flag", "/payload"],
]) test(`gpg rejects unknown options before effects: ${args.join(" ")}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/payload", new TextEncoder().encode("message"));
  const before = await fs.readdir("/");
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = (...parameters) => { reads++; return readFile(...parameters); };
  const result = await runGpg(fs, args);
  assert.deepEqual(result, { exitCode: 2, stdout: "", stderr: "gpg: unknown option: --unknown-nonexistent-flag\n" });
  assert.equal(reads, 0);
  assert.deepEqual(await fs.readdir("/"), before);
});

test("gpg preserves noninteractive armor options and literal option-like filenames", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/-payload", new TextEncoder().encode("message"));
  const result = await runGpg(fs, ["--batch", "--yes", "--no-tty", "--armor", "--detach-sign", "--", "-payload"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /-----BEGIN PGP SIGNATURE-----/);
  await fs.writeFile("/signature", new TextEncoder().encode(result.stdout));
  const verified = await runGpg(fs, ["--verify", "/signature", "/-payload"]);
  assert.equal(verified.exitCode, 0, verified.stderr);
});

test("gpg generates Ed25519 keys, lists keys, signs detached PGP signatures, and verifies them", async () => {
  const fs = createMemoryFileSystem();

  const gen = await runGpg(fs, ["--quick-generate-key", "Alice <alice@example.com>", "ed25519", "sign", "never"]);
  assert.equal(gen.exitCode, 0);
  assert.match(gen.stdout, /Alice <alice@example\.com>/);

  const list = await runGpg(fs, ["--list-secret-keys"]);
  assert.equal(list.exitCode, 0);
  assert.match(list.stdout, /Alice <alice@example\.com>/);

  await fs.writeFile("/payload.txt", new TextEncoder().encode("tree abcdef\nauthor Alice\n\nsigned commit\n"));
  const sign = await runGpg(fs, [
    "--detach-sign",
    "--armor",
    "-u",
    "Alice <alice@example.com>",
    "-o",
    "/payload.txt.asc",
    "/payload.txt",
  ]);
  assert.equal(sign.exitCode, 0);
  const sigText = new TextDecoder().decode(await fs.readFile("/payload.txt.asc"));
  assert.match(sigText, /-----BEGIN PGP SIGNATURE-----/);

  const verify = await runGpg(fs, ["--status-fd=1", "--verify", "/payload.txt.asc", "/payload.txt"]);
  assert.equal(verify.exitCode, 0);
  assert.match(verify.stdout, /\[GNUPG:\] GOODSIG/);
  assert.match(verify.stderr, /Good signature from "Alice <alice@example\.com>"/);
});


test("gpg requires the signing public key in the verification keyring", async () => {
  const fs = createMemoryFileSystem();
  const sign = await runGpg(fs, ["--detach-sign", "-u", "Alice"], "message");
  assert.equal(sign.exitCode, 0);
  const clean = createMemoryFileSystem();
  await clean.writeFile("/signature", new TextEncoder().encode(sign.stdout));
  const missing = await runGpg(clean, ["--status-fd=1", "--verify", "/signature"], "message");
  assert.notEqual(missing.exitCode, 0);
  assert.equal(missing.stdout, "");
  const exported = await runGpg(fs, ["--export"]);
  assert.equal((await runGpg(clean, ["--import"], exported.stdout)).exitCode, 0);
  assert.equal((await runGpg(clean, ["--verify", "/signature"], "message")).exitCode, 0);
});

test("gpg rejects a cryptographically valid signature with a forged hashed key ID", async () => {
  const fs = createMemoryFileSystem();
  const sign = await runGpg(fs, ["--detach-sign", "-u", "Attacker"], "message");
  const keys = JSON.parse(new TextDecoder().decode(await fs.readFile("/home/user/.gnupg/keyring.json"))) as { seedHex: string; pubHex: string; keyIdHex: string }[];
  const key = keys[0]!;
  const packet = Buffer.from(sign.stdout.split("\n").filter(l => l && !l.startsWith("-") && !l.startsWith("=")).join(""), "base64");
  const body = packet.subarray(packet[1] === 255 ? 6 : 2);
  const headerEnd = 6 + body.readUInt16BE(4);
  for (let offset = 6; offset < headerEnd; offset += 1 + body[offset]!) {
    if (body[offset + 1] === 16) body.fill(0x42, offset + 2, offset + 1 + body[offset]!);
  }
  const trailer = Buffer.alloc(6);
  trailer[0] = 4; trailer[1] = 255; trailer.writeUInt32BE(headerEnd, 2);
  const digest = await crypto.subtle.digest("SHA-256", Buffer.concat([Buffer.from("message"), body.subarray(0, headerEnd), trailer]));
  const privateKey = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", d: Buffer.from(key.seedHex, "hex").toString("base64url"), x: Buffer.from(key.pubHex, "hex").toString("base64url") }, "Ed25519", false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, digest));
  const unhashedEnd = headerEnd + 2 + body.readUInt16BE(headerEnd);
  body.set(new Uint8Array(digest).subarray(0, 2), unhashedEnd);
  body.set(signature.subarray(0, 32), unhashedEnd + 4);
  body.set(signature.subarray(32), unhashedEnd + 38);
  await fs.writeFile("/forged", new TextEncoder().encode(`-----BEGIN PGP SIGNATURE-----\n${packet.toString("base64")}\n-----END PGP SIGNATURE-----\n`));
  const result = await runGpg(fs, ["--status-fd=1", "--verify", "/forged"], "message");
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
});

test("gpg bounds import, signing, signature and payload file inputs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/large", new Uint8Array(65));
  for (const args of [["--import", "/large"], ["--detach-sign", "/large"], ["--verify", "/large"]]) {
    const result = await runGpg(fs, args, "", 64);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("maximum buffered size of 64 bytes"), result.stderr);
  }
});


test("gpg bounds verification payload files after reading a valid signature", async () => {
  const fs = createMemoryFileSystem();
  const sign = await runGpg(fs, ["--detach-sign"], "message");
  assert.equal(sign.exitCode, 0);
  await fs.writeFile("/signature", new TextEncoder().encode(sign.stdout));
  await fs.writeFile("/large", new Uint8Array(513));
  const result = await runGpg(fs, ["--verify", "/signature", "/large"], "", 512);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maximum buffered size of 512 bytes"), result.stderr);
  assert.equal(result.stdout, "");
});

test("gpg supports symmetric encryption (-c) and decryption (-d) with --passphrase and rejects wrong passphrases", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/sales.csv", new TextEncoder().encode("region,q1,q2\nNA,120,150\n"));

  const enc = await runGpg(fs, ["--batch", "--passphrase", "secret123", "-c", "--output", "/sales.csv.gpg", "/sales.csv"]);
  assert.equal(enc.exitCode, 0);

  const dec = await runGpg(fs, ["--batch", "--passphrase", "secret123", "-d", "/sales.csv.gpg"]);
  assert.equal(dec.exitCode, 0);
  assert.equal(dec.stdout, "region,q1,q2\nNA,120,150\n");

  const bad = await runGpg(fs, ["--batch", "--passphrase", "wrong", "-d", "/sales.csv.gpg"]);
  assert.notEqual(bad.exitCode, 0);
  assert.match(bad.stderr, /decryption failed/);

  const armorEnc = await runGpg(fs, ["--batch", "--passphrase=secret123", "--armor", "--symmetric", "/sales.csv"]);
  assert.equal(armorEnc.exitCode, 0);
  const ascBytes = await fs.readFile("/sales.csv.asc");
  assert.match(new TextDecoder().decode(ascBytes), /-----BEGIN PGP MESSAGE-----/);
  const armorDec = await runGpg(fs, ["--batch", "--passphrase=secret123", "--decrypt", "/sales.csv.asc"]);
  assert.equal(armorDec.exitCode, 0);
  assert.equal(armorDec.stdout, "region,q1,q2\nNA,120,150\n");
});
