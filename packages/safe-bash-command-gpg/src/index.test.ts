import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts";
import { createGpgCommand, settings } from "./index.js";

async function runGpg(
  fs: FileSystem,
  args: string[],
  stdinText = "",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cmd = createGpgCommand();
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

