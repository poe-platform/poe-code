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

test("ssh-keygen rejects unsupported and incomplete options without creating keys", async () => {
  for (const args of [["--help"], ["--unknown"], ["-f"], ["-f", "/key", "--unknown"]]) {
    const fs = createMemoryFileSystem();
    const result = await runCmd(createSshKeygenCommand(), fs, args);
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("unsupported option"));
    assert.deepEqual(await fs.readdir("/"), []);
  }
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


test("SSHSIG authorization checks identity, namespace, key and comment lines", async () => {
  const fs = createMemoryFileSystem();
  const cmd = createSshKeygenCommand();
  assert.equal((await runCmd(cmd, fs, ["-f", "/key"])).exitCode, 0);
  assert.equal((await runCmd(cmd, fs, ["-f", "/other"])).exitCode, 0);
  await fs.writeFile("/message", new TextEncoder().encode("message"));
  assert.equal((await runCmd(cmd, fs, ["-Y", "sign", "-f", "/key", "-n", "git", "/message"])).exitCode, 0);
  const pub = new TextDecoder().decode(await fs.readFile("/key.pub")).trim();
  const other = new TextDecoder().decode(await fs.readFile("/other.pub")).trim();
  const verify = ["-Y", "verify", "-f", "/allowed", "-I", "alice@example.com", "-n", "git", "-s", "/message.sig"];
  for (const line of ["", `# alice@example.com ${pub}`, `bob@example.com ${pub}`, `alice@example.com ${other}`, `alice@example.com namespaces="file" ${pub}`, `alice@example.com cert-authority ${pub}`, `alice@example.com unknown-option ${pub}`, `*,!alice@example.com ${pub}`]) {
    await fs.writeFile("/allowed", new TextEncoder().encode(line));
    const result = await runCmd(cmd, fs, verify, "message");
    assert.notEqual(result.exitCode, 0, line);
    assert.equal(result.stdout, "");
  }
  for (const line of [`alice@example.com ${pub}`, `bob,?lice@*.com namespaces="file,git" ${pub}`]) {
    await fs.writeFile("/allowed", new TextEncoder().encode(line));
    assert.equal((await runCmd(cmd, fs, verify, "message")).exitCode, 0, line);
  }
  const wrongNamespace = [...verify];
  wrongNamespace[7] = "file";
  assert.notEqual((await runCmd(cmd, fs, wrongNamespace, "message")).exitCode, 0);
  for (const missing of ["-f", "-I", "-n"]) {
    const args = [...verify];
    args.splice(args.indexOf(missing), 2);
    assert.notEqual((await runCmd(cmd, fs, args, "message")).exitCode, 0, missing);
  }
  await fs.writeFile("/allowed", new TextEncoder().encode(`  # alice@example.com ${pub}`));
  assert.notEqual((await runCmd(cmd, fs, ["-Y", "find-principals", "-f", "/allowed", "-s", "/message.sig"])).exitCode, 0);
});

test("ssh-keygen bounds every file input without modifying oversized known_hosts", async () => {
  const fs = createMemoryFileSystem();
  const large = new Uint8Array(65).fill(65);
  await fs.writeFile("/large", large);
  const cmd = createSshKeygenCommand({ limits: { maxBufferedBytes: 64 } });
  for (const args of [["-y", "-f", "/large"], ["-l", "-f", "/large"], ["-F", "host", "-f", "/large"], ["-R", "host", "-f", "/large"], ["-Y", "sign", "-f", "/large"], ["-Y", "verify", "-s", "/large"], ["-Y", "find-principals", "-s", "/large"]]) {
    const result = await runCmd(cmd, fs, args);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("maximum buffered size of 64 bytes"), result.stderr);
  }
  assert.deepEqual(await fs.readFile("/large"), large);
});


test("ssh-keygen bounds signing payloads and allowed signer files", async () => {
  const fs = createMemoryFileSystem();
  const cmd = createSshKeygenCommand();
  assert.equal((await runCmd(cmd, fs, ["-f", "/key"])).exitCode, 0);
  await fs.writeFile("/large", new Uint8Array(513));
  await fs.writeFile("/message", new TextEncoder().encode("message"));
  assert.equal((await runCmd(cmd, fs, ["-Y", "sign", "-f", "/key", "-n", "git", "/message"])).exitCode, 0);
  const bounded = createSshKeygenCommand({ maxBufferedBytes: 512 });
  for (const args of [["-Y", "sign", "-f", "/key", "-n", "git", "/large"], ["-Y", "verify", "-f", "/large", "-I", "alice", "-n", "git", "-s", "/message.sig"], ["-Y", "find-principals", "-f", "/large", "-s", "/message.sig"]]) {
    const result = await runCmd(bounded, fs, args, "message");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("maximum buffered size of 512 bytes"), result.stderr);
  }
  await assert.rejects(fs.readFile("/large.sig"));
});
