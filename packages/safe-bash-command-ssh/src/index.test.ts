import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import type { CommandContext, CommandDefinition } from "safe-bash-contracts";
import { createSshCommand, createSshKeygenCommand, settings } from "./index.js";

async function runCmd(
  cmd: CommandDefinition,
  fs: FileSystem,
  args: string[],
  stdinText = "",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

test("ssh and ssh-keygen export standard contract and settings", () => {
  assert.equal(createSshCommand().name, "ssh");
  assert.equal(createSshKeygenCommand().name, "ssh-keygen");
  assert.equal(settings().maxBufferedBytes, Infinity);
});

test("ssh-keygen generates Ed25519 keys, derives pubkey (-y), fingerprints (-l), and signs/verifies SSHSIG (-Y)", async () => {
  const fs = createMemoryFileSystem();
  const keygen = createSshKeygenCommand();

  const gen = await runCmd(keygen, fs, [
    "-t",
    "ed25519",
    "-f",
    "/home/user/.ssh/id_ed25519",
    "-C",
    "alice@example.com",
    "-N",
    "",
  ]);
  assert.equal(gen.exitCode, 0);
  assert.match(gen.stdout, /SHA256:/);

  const derived = await runCmd(keygen, fs, ["-y", "-f", "/home/user/.ssh/id_ed25519"]);
  assert.equal(derived.exitCode, 0);
  const pubOnDisk = new TextDecoder().decode(await fs.readFile("/home/user/.ssh/id_ed25519.pub"));
  assert.equal(derived.stdout.trim(), pubOnDisk.trim());

  const fpRes = await runCmd(keygen, fs, ["-l", "-f", "/home/user/.ssh/id_ed25519.pub"]);
  assert.equal(fpRes.exitCode, 0);
  assert.match(fpRes.stdout, /^256 SHA256:/);

  // Sign and verify payload with SSHSIG (-Y sign / -Y verify)
  await fs.writeFile("/commit.txt", new TextEncoder().encode("tree 12345\nauthor Alice\n\nsigned commit\n"));
  await fs.writeFile(
    "/allowed_signers",
    new TextEncoder().encode(`alice@example.com ${pubOnDisk.trim()}\n`),
  );

  const signRes = await runCmd(keygen, fs, [
    "-Y",
    "sign",
    "-f",
    "/home/user/.ssh/id_ed25519",
    "-n",
    "git",
    "/commit.txt",
  ]);
  assert.equal(signRes.exitCode, 0);

  const principalsRes = await runCmd(keygen, fs, [
    "-Y",
    "find-principals",
    "-f",
    "/allowed_signers",
    "-s",
    "/commit.txt.sig",
  ]);
  assert.equal(principalsRes.exitCode, 0);
  assert.equal(principalsRes.stdout.trim(), "alice@example.com");

  const verifyRes = await runCmd(
    keygen,
    fs,
    [
      "-Y",
      "verify",
      "-f",
      "/allowed_signers",
      "-I",
      "alice@example.com",
      "-n",
      "git",
      "-s",
      "/commit.txt.sig",
    ],
    "tree 12345\nauthor Alice\n\nsigned commit\n",
  );
  assert.equal(verifyRes.exitCode, 0);
  assert.match(verifyRes.stdout, /Good "git" signature for alice@example\.com with ED25519 key SHA256:/);
});
