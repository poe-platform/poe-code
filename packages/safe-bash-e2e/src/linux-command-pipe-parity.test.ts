import { link, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { gitCommands } from "@poe-platform/safe-bash/commands/git";
import assert from "node:assert/strict";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";
import { codecInput, createLinuxCommandDirectory, linuxCodecs, linuxCommands, linuxEnv, linuxMutations, observeMutation, readEffects, readZipMembers, resetEffects, runLinuxCommand, supportsHostPlugins } from "./linux-command-workloads.js";

test("Linux command pipe results match in TypeScript and Rust", async t => {
  const ts = await SafeBashE2EHarness.create({ env: linuxEnv, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env: linuxEnv, cwd: "/workspace", forceNative: true });
  let cwd: string | undefined;
  try {
    cwd = await createLinuxCommandDirectory(ts.fs, rust.fs);
    for (const { cmd, args, script, input } of linuxCommands("alpha\nbeta\nbeta\n")) {
      await t.test(script, async t => {
        if (cmd === "git") {
          if (!supportsHostPlugins) return t.skip("The Git plugin needs WebAssembly Promise Integration");
          ts.shell.use(gitCommands());
          rust.use(gitCommands());
        }
        const [code, stdout, stderr] = await runLinuxCommand(cmd, args, input, cwd);
        const members = cmd === "zip" ? await readZipMembers(cwd!, stdout, args.slice(2)) : undefined;
        for (const shell of [ts.shell, rust]) {
          const result = await shell.exec(script, { stdin: input });
          assert.deepEqual([result.exitCode, Buffer.from(result.stderrBytes)], [code, stderr]);
          const bytes = Buffer.from(result.stdoutBytes);
          if (members) assert.deepEqual(await readZipMembers(cwd!, bytes, args.slice(2)), members);
          else assert.deepEqual(bytes, stdout);
        }
      });
    }
    for (const { cmd, args, script, input } of linuxMutations) {
      const dir = cwd;
      await t.test(script, async () => {
        await resetEffects(dir);
        const reference = await runLinuxCommand(cmd, args, input, dir);
        assert.equal(reference[0], 0, reference[2].toString());
        const expected = await observeMutation(dir, cmd, reference);
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(dir, view);
          const result = await shell.exec(script, { stdin: input });
          const observed = await observeMutation(dir, cmd, [result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], view);
          assert.deepEqual(observed, expected, shell.constructor.name);
        }
      });
    }
    await t.test("split preserves a UTF-8 byte order mark at the start of the selected chunk", async () => {
      const input = Buffer.from("abcd\uFEFFx");
      const args = ["-n", "2/2"];
      const reference = await runLinuxCommand("split", args, input);
      const fast = sb.evalSyncSplit(input, args);
      assert.equal(fast, reference[1].toString("utf8"));
      for (const shell of [ts.shell, rust]) {
        const result = await shell.exec("split -n 2/2", { stdin: input });
        assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference);
      }
    });
    await t.test("split refuses to overwrite its input before writing the colliding piece", async () => {
      const dir = cwd!;
      for (const alias of ["same", "hard", "symlink", "late-hard", "quoted-hard", "newline-hard"]) {
        const source = alias === "same" ? "effects/xaa" : "effects/source";
        const prefix = alias === "quoted-hard" ? "effects/a'b" : alias === "newline-hard" ? "effects/a\nb" : "effects/x";
        const output = prefix + (alias === "late-hard" ? "ab" : "aa");
        await resetEffects(dir);
        if (alias === "same") await writeFile(dir + "/" + source, Buffer.from("abcdefghij"));
        else if (alias === "symlink") await symlink("source", dir + "/" + output);
        else await link(dir + "/" + source, dir + "/" + output);
        const original = await readFile(dir + "/" + source);
        const args = ["-b", "4", source, prefix];
        const reference = await runLinuxCommand("split", args, "", dir);
        assert.equal(reference[0], 1);
        assert.match(reference[2].toString(), /would overwrite input/);
        assert.deepEqual(await readFile(dir + "/" + source), original);
        const expected = await readEffects(dir, "split");
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(dir, view);
          if (alias === "same") await view.writeFile("/workspace/" + source, original);
          else if (alias === "symlink") await view.symlink!("source", "/workspace/" + output);
          else await view.link!("/workspace/" + source, "/workspace/" + output);
          const result = await shell.exec(`split -b 4 "${source}" "${prefix}"`);
          assert.equal(result.exitCode, reference[0], shell.constructor.name + ": " + alias);
          assert.deepEqual(Buffer.from(result.stdoutBytes), reference[1]);
          assert.deepEqual(Buffer.from(result.stderrBytes), reference[2], shell.constructor.name + ": " + alias);
          assert.deepEqual(await readEffects(dir, "split", view), expected);
        }
      }
    });
    await t.test("split keeps its first piece when a later output aliases it", async () => {
      for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
        await resetEffects(cwd!, view);
        await view.writeFile("/workspace/effects/xaa", Buffer.from("old"));
        await view.link!("/workspace/effects/xaa", "/workspace/effects/xab");
        const source = await view.readFile("/workspace/effects/source");
        const result = await shell.exec("split -b 4 effects/source effects/x");
        assert.equal(result.exitCode, 1, result.stderr);
        assert.match(result.stderr, /aliases an earlier output/);
        for (const name of ["xaa", "xab"]) assert.deepEqual(Buffer.from(await view.readFile("/workspace/effects/" + name)), Buffer.from(source.subarray(0, 4)));
        assert.deepEqual(await view.readFile("/workspace/effects/source"), source);
      }
    });
    await t.test("csplit searches original line bytes with GNU basic regular expressions", async () => {
      const input = Buffer.concat([Buffer.from([0, 10]), Buffer.from("one\né\nab\n"), Buffer.from([0xff, 10]), Buffer.from("z\n")]);
      for (const locale of ["C", "C.utf8"]) {
        for (const pattern of ["/^.$/", "/^..$/", "/(one|z)/", "/one\\|z/", "/o\\{1,2\\}/", "/n\\{2\\}/", "/é/"]) {
          const args = ["-f", "effects/y", "-", pattern];
          await resetEffects(cwd!);
          const reference = await runLinuxCommand("env", ["LC_ALL=" + locale, "csplit", ...args], input, cwd);
          const expected = await readEffects(cwd!, "csplit");
          for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
            await resetEffects(cwd!, view);
            const result = await shell.exec("LC_ALL=" + locale + " csplit -f effects/y - '" + pattern + "'", { stdin: input });
            assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference, shell.constructor.name + ": " + locale + " " + pattern);
            assert.deepEqual(await readEffects(cwd!, "csplit", view), expected);
          }
        }
      }
    });
    await t.test("diff3 compares and emits the original bytes of each variant", async () => {
      const files = ["ours", "base", "theirs"];
      // The valid UTF-8 encodes U+E080, which must also stay distinct from the raw 0x80 byte.
      const inputs = ["800a", "ee82800a", "ff0a"].map(hex => Buffer.from(hex, "hex"));
      for (const [i, name] of files.entries()) {
        await writeFile(cwd + "/" + name, inputs[i]!);
        for (const view of [ts.fs, rust.fs]) await view.writeFile("/workspace/" + name, inputs[i]!);
      }
      for (const flags of [[], ["-e"], ["-m", "-E"], ["-m"]]) {
        for (const useStdin of [false, true]) {
          const args = [...flags, "ours", useStdin ? "-" : "base", "theirs"];
          const input = useStdin ? inputs[1]! : "";
          const reference = await runLinuxCommand("diff3", args, input, cwd);
          for (const shell of [ts.shell, rust]) {
            const result = await shell.exec("diff3 " + args.join(" "), { stdin: input });
            assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference, shell.constructor.name);
          }
        }
      }
    });
    await t.test("env preserves its listing order when passing entries to a child", async () => {
      const assignments = ["Z=first", "A=one", "M=", "Z=last"];
      const [code, listing, stderr] = await runLinuxCommand("env", ["-i", "-0", ...assignments], "");
      assert.equal(code, 0);
      assert.equal(stderr.length, 0);
      for (const command of ["env", "printenv"]) {
        const child = await runLinuxCommand("env", ["-i", ...assignments, command, "-0"], "");
        assert.deepEqual(child, [code, listing, stderr]);
      }
      for (const shell of [ts.shell, rust]) {
        const prefix = "env -i " + assignments.join(" ");
        const own = await shell.exec("env -i -0 " + assignments.join(" "));
        assert.equal(own.exitCode, code, own.stderr);
        // GNU 9.4/Linux and the recorded GNU 9.7/macOS order these entries differently.
        assert.deepEqual(own.stdout.split("\0").sort(), listing.toString().split("\0").sort());
        for (const command of ["env", "printenv"]) {
          const child = await shell.exec(prefix + " " + command + " -0");
          assert.equal(child.exitCode, code, child.stderr);
          assert.deepEqual(Buffer.from(child.stderrBytes), stderr);
          assert.deepEqual(child.stdoutBytes, own.stdoutBytes, shell.constructor.name + ": " + command);
        }
        const withoutZ = await shell.exec(prefix + " env -u Z printenv -0");
        assert.equal(withoutZ.exitCode, 0, withoutZ.stderr);
        assert.equal(withoutZ.stdout, own.stdout.split("\0").filter(entry => !entry.startsWith("Z=")).join("\0"));
      }
    });
    const binary = codecInput();
    for (const [compress, decompress, cat] of linuxCodecs) {
      await t.test(compress + " streams decode in both directions", async () => {
        const [status, packed, errors] = await runLinuxCommand(compress, ["-c"], binary);
        assert.equal(status, 0, errors.toString());
        for (const shell of [ts.shell, rust]) {
          const written = await shell.exec(compress + " -c", {stdin: binary});
          assert.equal(written.exitCode, status, written.stderr);
          assert.deepEqual(Buffer.from(written.stderrBytes), errors);
          const [code, decoded, stderr] = await runLinuxCommand(decompress, ["-c"], written.stdoutBytes);
          assert.equal(code, 0, stderr.toString());
          assert.deepEqual(decoded, binary);
          for (const cmd of [decompress, cat]) {
            const reference = await runLinuxCommand(cmd, ["-c"], packed);
            const read = await shell.exec(cmd + " -c", {stdin: packed});
            assert.deepEqual([read.exitCode, Buffer.from(read.stdoutBytes), Buffer.from(read.stderrBytes)], reference, cmd);
          }
        }
      });
    }
  } finally {
    if (cwd) await rm(cwd, { recursive: true, force: true });
    await ts.dispose();
    await rust.dispose();
  }
});

test("yes produces bytes until its downstream reader closes the pipe", async () => {
  const ts = await SafeBashE2EHarness.create({ env: linuxEnv, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env: linuxEnv, forceNative: true });
  try {
    for (const script of [
      'yes | cat | head -c 1; echo "${PIPESTATUS[*]}"',
      'yes q | cat -u -- - | cat -n | head -n 1101 | tail -n 1; echo "${PIPESTATUS[*]}"',
      String.raw`yes $'\t\377\r' | cat -A | head -c 17003 | cksum`,
      'yes | cat /dev/null | head; echo "${PIPESTATUS[*]}"',
      'yes | cat <<<side | head; echo "${PIPESTATUS[*]}"',
      'yes | cat --not-an-option | head; echo "${PIPESTATUS[*]}"',
      "yes >&-",
      "yes --help >&-",
      "yes -x >&-",
      String.raw`yes $'\xff' | head -c 5`,
      "yes 2>&1 | head -c 3",
      "shopt -s lastpipe; yes word | read line; echo \"$line\"",
      "yes | head -c 1 </dev/null",
      "yes " + "x".repeat(25000) + " | head -c 3",
      "yes α β | head -n 11001 | wc -l",
      "set -o pipefail; yes | head -c 1",
      "yes | true; echo \"${PIPESTATUS[*]}\"",
      "yes -x | head; echo \"${PIPESTATUS[*]}\"",
      "yes() { echo once; }; yes | head; echo \"${PIPESTATUS[*]}\"",
    ]) {
      const reference = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], "");
      for (const shell of [ts.shell, rust]) {
        const result = await shell.exec(script);
        assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference, shell.constructor.name + ": " + script);
      }
    }
    for (const script of ["yes", "yes >/output", "yes | wc -c"]) {
      await assert.rejects(rust.exec(script, { limits: { maxOutputBytes: 32768 } }), { limit: "maxOutputBytes" });
    }
  } finally { rust.dispose(); await ts.dispose(); }
});

test("ssh-keygen creates fresh private Ed25519 keys usable by OpenSSH", async () => {
  const ts = await SafeBashE2EHarness.create({ env: linuxEnv, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env: linuxEnv, cwd: "/workspace", forceNative: true });
  let dir: string | undefined;
  try {
    dir = await createLinuxCommandDirectory(ts.fs, rust.fs);
    const args = ["-t", "ed25519", "-N", "", "-C", "parity", "-f", "key"];
    const script = "ssh-keygen -t ed25519 -N '' -C parity -f key";
    const [code, , stderr] = await runLinuxCommand("ssh-keygen", args, "", dir);
    assert.equal(code, 0, stderr.toString());
    const mode = (await lstat(dir + "/key")).mode & 0o777;
    assert.equal(mode, 0o600);
    for (const [shell, fs] of [[rust, rust.fs], [ts.shell, ts.fs]] as const) {
      let previous = "";
      for (let run = 0; run < 2; run++) {
        const key = await shell.exec(script);
        assert.equal(key.exitCode, 0, key.stderr);
        const pub = Buffer.from(await fs.readFile("/workspace/key.pub")).toString();
        assert.notEqual(pub, previous, "same path and comment must generate independent keys");
        previous = pub;
        assert.equal((await fs.stat("/workspace/key")).mode & 0o777, mode);
        await writeFile(dir + "/key", await fs.readFile("/workspace/key"), { mode: 0o600 });
        await writeFile(dir + "/key.pub", pub);
        await writeFile(dir + "/allowed", "tester " + pub);
        const signature = await runLinuxCommand("ssh-keygen", ["-Y", "sign", "-f", "key", "-n", "test"], "payload", dir);
        assert.equal(signature[0], 0, signature[2].toString());
        await writeFile(dir + "/signature", signature[1]);
        const verified = await runLinuxCommand("ssh-keygen", ["-Y", "verify", "-f", "allowed", "-I", "tester", "-n", "test", "-s", "signature"], "payload", dir);
        assert.equal(verified[0], 0, verified[2].toString());
        assert.notEqual((await shell.exec(script)).exitCode, 0, "must not overwrite an occupied private-key path");
        assert.equal(Buffer.from(await fs.readFile("/workspace/key.pub")).toString(), pub);
        await fs.rm("/workspace/key");
        await fs.rm("/workspace/key.pub");
      }
      for (const options of ["-t ed25519 -N not-empty", "-t rsa -N ''"]) {
        const unsupported = await shell.exec("ssh-keygen " + options + " -f key");
        assert.notEqual(unsupported.exitCode, 0, "must not silently substitute a plaintext Ed25519 key");
        await assert.rejects(fs.stat("/workspace/key"), { code: "ENOENT" });
      }
      await fs.symlink!("absent", "/workspace/key");
      assert.notEqual((await shell.exec(script)).exitCode, 0);
      await assert.rejects(fs.stat("/workspace/absent"), { code: "ENOENT" });
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    rust.dispose();
    await ts.dispose();
  }
});

test("gpg matches GnuPG when an export selects no keys", async () => {
  const ts = await SafeBashE2EHarness.create({ fs: new sb.MemoryFileSystem() });
  ts.shell.use(sb.gpgCommands({ replace: true }));
  const rust = new RustWasmBash({ cwd: "/workspace", forceNative: true });
  let dir: string | undefined;
  try {
    dir = await createLinuxCommandDirectory(ts.fs, rust.fs);
    const home = dir + "/gnupg";
    await mkdir(home, { mode: 0o700 });
    const options = ["--no-options", "--no-autostart", "--batch", "--homedir", home];
    const initialized = await runLinuxCommand("gpg", [...options, "--list-keys"], "", dir);
    assert.equal(initialized[0], 0, initialized[2].toString());
    for (const args of [["--export"], ["-a", "--export", "missing"], ["-q", "-o", "missing.key", "--export", "missing"]]) {
      const expected = await runLinuxCommand("gpg", [...options, ...args], "", dir);
      assert.equal(expected[0], 0);
      await assert.rejects(lstat(dir + "/missing.key"), { code: "ENOENT" });
      for (const [shell, fs] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
        const result = await shell.exec("gpg " + args.join(" "));
        assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], expected);
        await assert.rejects(fs.stat("/workspace/missing.key"), { code: "ENOENT" });
      }
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    await ts.dispose();
    rust.dispose();
  }
});

test("GnuPG imports a safe-bash Ed25519 certificate and verifies its detached signature", async () => {
  const rust = new RustWasmBash({ cwd: "/workspace", forceNative: true });
  const ts = await SafeBashE2EHarness.create({ fs: new sb.MemoryFileSystem() });
  let dir: string | undefined;
  try {
    dir = await createLinuxCommandDirectory(rust.fs);
    const home = dir + "/gnupg";
    await mkdir(home, { mode: 0o700 });
    const options = ["--no-options", "--no-autostart", "--batch", "--homedir", home];
    for (const [shell, peer, who] of [[rust, ts.shell, "rust"], [ts.shell, rust, "typescript"]] as const) {
      const uid = `Parity ${who} <${who}@example.org>`;
      const generated = await shell.exec(`gpg --quick-generate-key '${uid}' ed25519 sign 0`);
      assert.equal(generated.exitCode, 0, generated.stderr);
      const payload = Buffer.from([0xff, 0, 9, 10]);
      const signature = await shell.exec(`gpg -a -u '${uid}' --detach-sign`, { stdin: payload });
      assert.equal(signature.exitCode, 0, signature.stderr);
      await writeFile(dir + "/signature.asc", signature.stdoutBytes);
      for (const flags of ["", "-a"]) {
        const cert = await shell.exec("gpg " + flags + " --export " + who);
        assert.equal(cert.exitCode, 0, cert.stderr);
        if (!flags) {
          const impersonation = Buffer.from(cert.stdoutBytes);
          const start = impersonation.indexOf(uid);
          assert.ok(start > 0);
          impersonation[start] = 88;
          for (const invalid of [impersonation, Buffer.concat([cert.stdoutBytes, Buffer.from([0xc5, 0])])]) {
            const rejected = await peer.exec("gpg --import", { stdin: invalid });
            assert.notEqual(rejected.exitCode, 0);
            assert.equal((await peer.exec("gpg --list-keys " + who)).stdout, "");
          }
        }
        const imported = await runLinuxCommand("gpg", [...options, "--status-fd=1", "--import"], cert.stdoutBytes, dir);
        assert.equal(imported[0], 0, imported[2].toString());
        assert.match(imported[1].toString(), /IMPORT_OK \d+ [A-F0-9]{40}/);
        const fingerprint = /IMPORT_OK \d+ ([A-F0-9]{40})/.exec(imported[1].toString())![1]!;
        const reexported = await runLinuxCommand("gpg", [...options, "--export", fingerprint], "", dir);
        assert.equal(reexported[0], 0, reexported[2].toString());
        const importedAgain = await peer.exec("gpg --import", { stdin: reexported[1] });
        assert.equal(importedAgain.exitCode, 0, importedAgain.stderr);
        await peer.exec("cat > /peer.sig", { stdin: signature.stdoutBytes });
        const peerVerified = await peer.exec("gpg --verify /peer.sig", { stdin: payload });
        assert.equal(peerVerified.exitCode, 0, peerVerified.stderr);
        assert.equal(cert.stdout.startsWith("-----BEGIN"), flags === "-a");
      }
      const verified = await runLinuxCommand("gpg", [...options, "--status-fd=1", "--verify", "signature.asc", "-"], payload, dir);
      assert.equal(verified[0], 0, verified[2].toString());
      assert.ok(verified[1].toString().includes(uid));
      assert.match(verified[1].toString(), /VALIDSIG [A-F0-9]{40}/);
      const modified = await runLinuxCommand("gpg", [...options, "--verify", "signature.asc", "-"], "changed", dir);
      assert.notEqual(modified[0], 0);
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    rust.dispose();
    await ts.dispose();
  }
});
