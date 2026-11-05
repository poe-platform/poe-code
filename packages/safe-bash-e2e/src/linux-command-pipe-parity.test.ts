import { link, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { gitCommands } from "@poe-platform/safe-bash/commands/git";
import assert from "node:assert/strict";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";
import { gpgDistributionKey, codecInput, createLinuxCommandDirectory, linuxCodecs, linuxCommands, linuxEnv, linuxMutations, observeMutation, readEffects, readZipMembers, resetEffects, runLinuxCommand, supportsHostPlugins } from "./linux-command-workloads.js";

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
    await t.test("jq sorting filters evaluate object keys before rejecting the input", async () => {
      for (const filter of ["sort", "unique", "min", "max", "sort_by(.)", "group_by(.+1)", "unique_by(empty)", "min_by(.,.)", "max_by(.)", 'sort_by(error("from key"))']) {
        for (const input of ['{"a":1,"b":2}', "false"]) {
          const reference = await runLinuxCommand("jq", ["-c", filter], input + "\n", cwd);
          assert.equal(reference[0], 5);
          for (const shell of [ts.shell, rust]) {
            const result = await shell.exec("jq -c '" + filter + "'", { stdin: input + "\n" });
            assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference, filter + " on " + input);
          }
        }
      }
    });
    await t.test("jq binary search streams search keys and uses jq length and indexing rules", async () => {
      for (const [filter, input] of [
        ["bsearch(1,0,2)", "[1,1,1,1]"], ["bsearch(empty)", "false"],
        ['bsearch(2,error("bad"))', "[1,2]"], ['first(bsearch(2,error("bad")))', "[1,2]"],
        ["bsearch(.[])", '[{"a":1},{"b":0}]'], ["bsearch(null)", "null\n{}\n[]\n0\n\"\""],
        ["bsearch(1)", "false"], ["bsearch(1)", '"xyz"'], ["bsearch(1)", '{"x":1}'],
        ["bsearch(1)", "-0.25"], ["length", '-0.25\n"💡"\nfalse'],
      ]) {
        const reference = await runLinuxCommand("jq", ["-c", filter], input + "\n", cwd);
        for (const shell of [ts.shell, rust]) {
          const result = await shell.exec("jq -c '" + filter + "'", { stdin: input + "\n" });
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference, filter + " on " + input);
        }
      }
    });
    await t.test("tsort consumes shared stdin only when it selects stdin", async () => {
      const edges = Buffer.concat([Buffer.alloc(65534, 32), Buffer.from("first\0suffix second\n")]);
      await writeFile(cwd + "/edges", edges);
      for (const fs of [ts.fs, rust.fs]) await fs.writeFile("/workspace/edges", edges);
      for (const script of ["{ tsort; cat; } < edges", "{ tsort -; cat; } < edges", "{ tsort edges; cat; } < samples/base", "{ tsort --bad; cat; } < samples/base"]) {
        const expected = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], "", cwd);
        for (const shell of [ts.shell, rust]) {
          const actual = await shell.exec(script);
          assert.equal(actual.stdoutBytes.length, expected[1].length, script);
          assert.deepEqual([actual.exitCode, Buffer.from(actual.stdoutBytes), Buffer.from(actual.stderrBytes)], expected, script);
        }
      }
    });
    await t.test("tsort opens the operand as written and names it in read and graph errors", async () => {
      for (const [name, contents] of [["odd names", "a b c"], ["loop's graph", "b a a b"]]) {
        await writeFile(cwd + "/" + name, contents);
        for (const fs of [ts.fs, rust.fs]) await fs.writeFile("/workspace/" + name, Buffer.from(contents));
      }
      for (const file of ["samples", "samples/base/", "samples/base/../ours", "absent/../samples", "", "not here", "odd names", "loop's graph"]) {
        const reference = await runLinuxCommand("tsort", [file], "", cwd);
        assert.equal(reference[0], 1);
        const script = "tsort '" + file.replaceAll("'", "'\\''") + "'";
        for (const shell of [ts.shell, rust]) {
          const actual = await shell.exec(script);
          assert.deepEqual([actual.exitCode, Buffer.from(actual.stdoutBytes), Buffer.from(actual.stderrBytes)], reference, script);
        }
      }
    });
    await t.test("qrencode chooses stdout or numbered files from the format and output operand", async () => {
      const argsOnly = await runLinuxCommand("qrencode", [], "ignored", cwd);
      for (const shell of [ts.shell, rust]) {
        const result = await shell.exec("qrencode", { stdin: "ignored" });
        assert.equal(result.exitCode, argsOnly[0]);
        assert.deepEqual(Buffer.from(result.stdoutBytes), argsOnly[1]);
        assert.match(result.stderr, /Usage: qrencode/);
      }
      for (const args of ["hello", "-r absent", "-t pNg hello", "-t ASCII -o '' hello", "-S -v 1 hello", "-S -t ASCII hello", "-S -v 1 -t ASCII hello"]) {
        const script = "qrencode " + args;
        const expected = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], "", cwd);
        for (const shell of [ts.shell, rust]) {
          const actual = await shell.exec(script);
          assert.deepEqual([actual.exitCode, Buffer.from(actual.stdoutBytes), Buffer.from(actual.stderrBytes)], expected, script);
        }
      }
      for (const [name, file] of [["-", "--01"], ["part", "part-01"], ["case.TxT", "case-01.TxT"], ["other.png", "other.png-01"], [".txt", ".txt-01"], ["", "-01"]] as const) {
        const script = "qrencode -S -v 1 -t ascii -o '" + name + "' hello";
        const expected = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], "", cwd);
        assert.equal(expected[0], 0);
        const bytes = await readFile(cwd + "/" + file);
        for (const [shell, fs] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          const actual = await shell.exec(script);
          assert.deepEqual([actual.exitCode, Buffer.from(actual.stdoutBytes), Buffer.from(actual.stderrBytes)], expected, script);
          assert.deepEqual(Buffer.from(await fs.readFile("/workspace/" + file)), bytes);
        }
      }
    });
    await t.test("qrencode rounds the dark-module percentage before choosing a mask", async () => {
      for (const [level, data] of [["L", "0123456789"], ["M", "012345678901234567896"]] as const) {
        const args = ["-t", "ASCII", "-m", "0", "-l", level, data];
        const [code, bytes] = await runLinuxCommand("qrencode", args, "");
        assert.equal(code, 0);
        for (const shell of [rust, ts.shell]) {
          const result = await shell.exec("qrencode " + args.join(" "));
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual(Buffer.from(result.stdoutBytes), bytes);
        }
      }
    });
    await t.test("qrencode reads clustered short options and diagnoses the first unknown byte", async () => {
      for (const script of ["qrencode -8itASCII Hi", "qrencode -iV --bad", "qrencode --version", "qrencode -Mit UTF8 123", "qrencode -abc", "qrencode -é", "qrencode -8é", "qrencode $'-8\\xff'"]) {
        const expected = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], "", cwd);
        for (const shell of [rust, ts.shell]) {
          const result = await shell.exec(script);
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], expected, script);
        }
      }
    });
    await t.test("qrencode selects the first operand and encodes binary or NUL-terminated input", async () => {
      const dash = Buffer.from([65, 0, 255, 66]);
      await writeFile(cwd + "/-", dash);
      for (const fs of [ts.fs, rust.fs]) await fs.writeFile("/workspace/-", dash);
      for (const [args, input] of [
        ["-r absent first second", "ignored"], ["-r samples/ours", "ignored"],
        ["-8 -r -", "not the file"], ["-r absent", "not the file"], ["-r samples", ""], ["-r ''", "ignored"],
        ["", ""], ["''", "ignored"], ["", Buffer.from([0])], ["-8", Buffer.from([0])],
        ["", Buffer.from([65, 0, 66])], ["-8", Buffer.from([65, 0, 66])],
      ] as const) {
        const script = "qrencode -t ASCII -o - " + args;
        const expected = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], input, cwd);
        for (const shell of [ts.shell, rust]) {
          const result = await shell.exec(script, { stdin: input });
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], expected, script);
        }
      }
    });
    await t.test("whoami follows GNU option ordering and reports the original argument bytes", async () => {
      const scripts = [
        "whoami operand --he", "whoami operand -é", "whoami -- $'a\\x27b\\nß'",
        "whoami operand --ver=x", "whoami --=x", "whoami --unknown",
        "POSIXLY_CORRECT=1 whoami first --help", "whoami $'-\\xff'", "whoami -- $'\\xff'",
      ];
      for (const script of scripts) {
        const expected = await runLinuxCommand("bash", ["--noprofile", "--norc", "-c", script], "", cwd);
        for (const shell of [ts.shell, rust]) {
          const actual = await shell.exec(script);
          assert.deepEqual([actual.exitCode, Buffer.from(actual.stdoutBytes), Buffer.from(actual.stderrBytes)], expected, script);
        }
      }
    });
    for (const { cmd, args, script, input } of linuxMutations) {
      const dir = cwd;
      await t.test(script, async () => {
        await resetEffects(dir, undefined, cmd);
        const reference = await runLinuxCommand(cmd, args, input, dir);
        assert.equal(reference[0], 0, reference[2].toString());
        const expected = await observeMutation(dir, cmd, reference);
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(dir, view, cmd);
          const result = await shell.exec(script, { stdin: input });
          const observed = await observeMutation(dir, cmd, [result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], view);
          assert.deepEqual(observed, expected, shell.constructor.name);
        }
      });
    }
    await t.test("ssh-keygen preserves linked originals and replaces an existing backup", async () => {
      for (const symbolic of [false, true]) {
        const file = "effects/alias";
        const args = ["-q", "-R", "host", "-f", file];
        await resetEffects(cwd!, undefined, "ssh-keygen");
        if (symbolic) await symlink("source", cwd + "/" + file);
        else await link(cwd + "/effects/source", cwd + "/" + file);
        await writeFile(cwd + "/" + file + ".old", "prior backup");
        const reference = await runLinuxCommand("ssh-keygen", args, "", cwd);
        assert.equal(reference[0], 0, reference[2].toString());
        const expected = await readEffects(cwd!, "ssh-keygen");
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(cwd!, view, "ssh-keygen");
          const path = "/workspace/" + file;
          if (symbolic) await view.symlink!("source", path);
          else await view.link!("/workspace/effects/source", path);
          await view.writeFile(path + ".old", Buffer.from("prior backup"));
          const result = await shell.exec("ssh-keygen " + args.join(" "));
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference);
          assert.deepEqual(await readEffects(cwd!, "ssh-keygen", view), expected);
          if (!symbolic) assert.equal((await view.stat(path + ".old")).ino, (await view.stat("/workspace/effects/source")).ino);
        }
      }
    });
    await t.test("ssh-keygen rejects fingerprints with removal before touching known_hosts", async () => {
      for (const file of ["effects/source", "effects/missing"]) {
        const args = ["-l", "-R", "host", "-f", file];
        await resetEffects(cwd!, undefined, "ssh-keygen");
        const reference = await runLinuxCommand("ssh-keygen", args, "", cwd);
        assert.equal(reference[0], 1);
        const expected = await readEffects(cwd!, "ssh-keygen");
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(cwd!, view, "ssh-keygen");
          const result = await shell.exec("ssh-keygen " + args.join(" "));
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference);
          assert.deepEqual(await readEffects(cwd!, "ssh-keygen", view), expected);
        }
      }
    });
    await t.test("ssh-keygen combining lookup and removal selects the last host and never writes", async () => {
      const file = "effects/source";
      for (const options of ["-R absent -F host", "-F absent -R host", "-R host -F absent", "-q -F absent -R host", "-R unused -F broken"]) {
        const args = [...options.split(" "), "-f", file];
        await resetEffects(cwd!, undefined, "ssh-keygen");
        const malformed = Buffer.from("broken junk x\nunrelated junk y\n");
        if (options.endsWith("broken")) await writeFile(cwd + "/" + file, malformed);
        const reference = await runLinuxCommand("ssh-keygen", args, "", cwd);
        const expected = await readEffects(cwd!, "ssh-keygen");
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(cwd!, view, "ssh-keygen");
          if (options.endsWith("broken")) await view.writeFile("/workspace/" + file, malformed);
          const result = await shell.exec("ssh-keygen " + args.join(" "));
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference);
          assert.deepEqual(await readEffects(cwd!, "ssh-keygen", view), expected);
        }
      }
    });
    await t.test("ssh-keygen leaves the original intact if the backup is a directory", async () => {
      const file = "effects/source";
      const args = ["-R", "host", "-f", file];
      await resetEffects(cwd!, undefined, "ssh-keygen");
      await mkdir(cwd + "/" + file + ".old", { mode: 0o700 });
      const before = await readEffects(cwd!, "ssh-keygen");
      const reference = await runLinuxCommand("ssh-keygen", args, "", cwd);
      assert.equal(reference[0], 255);
      assert.deepEqual((await readEffects(cwd!, "ssh-keygen")).filter(e => before.some(b => b.name === e.name)), before);
      for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
        await resetEffects(cwd!, view, "ssh-keygen");
        await view.mkdir("/workspace/" + file + ".old", { mode: 0o700 });
        const result = await shell.exec("ssh-keygen " + args.join(" "));
        assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference);
        assert.deepEqual(await readEffects(cwd!, "ssh-keygen", view), before);
      }
    });
    await t.test("ssh-keygen refuses to replace invalid known_hosts or create a missing file", async () => {
      for (const name of ["broken", "missing"]) {
        const original = Buffer.from("host ssh-ed25519 x\nmalformed\nhost ssh-rsa y\n");
        const file = "effects/" + name;
        await resetEffects(cwd!);
        if (name === "broken") await writeFile(cwd + "/" + file, original);
        const args = ["-R", "host", "-f", file];
        const reference = await runLinuxCommand("ssh-keygen", args, "", cwd);
        assert.notEqual(reference[0], 0);
        const expected = await readEffects(cwd!, "ssh-keygen");
        for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
          await resetEffects(cwd!, view);
          if (name === "broken") await view.writeFile("/workspace/" + file, original);
          const result = await shell.exec("ssh-keygen " + args.join(" "));
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], reference);
          assert.deepEqual(await readEffects(cwd!, "ssh-keygen", view), expected);
        }
      }
    });
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
    const missingArgs = ["--detach-sign", "-u", "missing-signer", "-o", "missing.sig"];
    const missing = await runLinuxCommand("gpg", [...options, ...missingArgs], "data", dir);
    assert.equal(missing[0], 2);
    for (const [shell, fs] of [[rust, rust.fs], [ts.shell, ts.fs]] as const) {
      const noKey = await shell.exec("gpg " + missingArgs.join(" "), { stdin: "data" });
      assert.equal(noKey.exitCode, missing[0]);
      assert.equal(noKey.stdout, "");
      assert.match(noKey.stderr, /No secret key/);
      await assert.rejects(fs.stat("/workspace/missing.sig"), { code: "ENOENT" });
      await assert.rejects(fs.stat("/home/user/.gnupg/keyring.json"), { code: "ENOENT" });
    }
    for (const [shell, peer, who] of [[rust, ts.shell, "rust"], [ts.shell, rust, "typescript"]] as const) {
      const uid = `Parity ${who} <${who}@example.org>`;
      const generated = await shell.exec(`gpg --quick-generate-key '${uid}' ed25519 sign 0`);
      assert.equal(generated.exitCode, 0, generated.stderr);
      const payload = Buffer.from([0xff, 0, 9, 10]);
      const signature = await shell.exec(`gpg -a --status-fd=2 -u '${uid}' --detach-sign`, { stdin: payload });
      assert.equal(signature.exitCode, 0, signature.stderr);
      await writeFile(dir + "/signature.asc", signature.stdoutBytes);
      let peerStatus = "";
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
        const selected = "0x" + fingerprint.toLowerCase();
        const byFingerprint = await shell.exec("gpg " + flags + " --export " + selected);
        assert.deepEqual(byFingerprint.stdoutBytes, cert.stdoutBytes);
        const byId = await shell.exec("gpg -a --status-fd=2 -u " + selected + " --detach-sign", { stdin: payload });
        assert.equal(byId.exitCode, 0, byId.stderr);
        assert.ok(byId.stderr.trimEnd().endsWith(" " + fingerprint));
        const reexported = await runLinuxCommand("gpg", [...options, "--export", fingerprint], "", dir);
        assert.equal(reexported[0], 0, reexported[2].toString());
        const importedAgain = await peer.exec("gpg --import", { stdin: reexported[1] });
        assert.equal(importedAgain.exitCode, 0, importedAgain.stderr);
        await peer.exec("cat > /peer.sig", { stdin: signature.stdoutBytes });
        const peerVerified = await peer.exec("gpg --status-fd=1 --verify /peer.sig -", { stdin: payload });
        assert.equal(peerVerified.exitCode, 0, peerVerified.stderr);
        peerStatus = peerVerified.stdout;
        assert.equal(cert.stdout.startsWith("-----BEGIN"), flags === "-a");
      }
      const verified = await runLinuxCommand("gpg", [...options, "--status-fd=1", "--verify", "signature.asc", "-"], payload, dir);
      assert.equal(verified[0], 0, verified[2].toString());
      assert.ok(verified[1].toString().includes(uid));
      const statusLine = (output: string) => output.split("\n").find(line => line.startsWith("[GNUPG:] VALIDSIG "));
      const valid = statusLine(verified[1].toString());
      assert.ok(valid);
      assert.equal(statusLine(peerStatus), valid);
      const fields = valid.split(" ");
      assert.equal(signature.stderr, `[GNUPG:] SIG_CREATED D 22 8 00 ${fields[4]} ${fields[2]}\n`);
      const fs = shell === rust ? rust.fs : ts.fs;
      await fs.writeFile("/workspace/first", payload);
      const last = Buffer.from("signed tail");
      await fs.writeFile("/workspace/last", last);
      const all = Buffer.concat([payload, last]);
      for (const [opts, data, file, armored] of [
        ["--detach-sign", payload, "", false],
        ["--detach-sign -", payload, "", false],
        ["-bsau " + who + " -o - first last", all, "", true],
        ["--detach-sign first last", all, "last.sig", false],
        ["--armor --detach-sign first", payload, "first.asc", true],
      ] as const) {
        const result = await shell.exec("umask 077; gpg " + opts, { stdin: payload });
        assert.equal(result.exitCode, 0, result.stderr);
        const bytes = file ? await fs.readFile("/workspace/" + file) : result.stdoutBytes;
        assert.ok(bytes.length > 0);
        assert.equal((bytes[0]! & 128) !== 0, !armored, opts);
        if (file) {
          assert.equal(result.stdout, "");
          assert.equal((await fs.stat("/workspace/" + file)).mode & 0o777, 0o600);
          const refused = await shell.exec("gpg --batch " + opts);
          assert.deepEqual([refused.exitCode, refused.stderr], [2, "gpg: signing failed: File exists\n"]);
          assert.deepEqual(await fs.readFile("/workspace/" + file), bytes);
          assert.equal((await shell.exec("gpg --batch --yes " + opts)).exitCode, 0);
        }
        await writeFile(dir + "/output.sig", bytes);
        const checked = await runLinuxCommand("gpg", [...options, "--verify", "output.sig", "-"], data, dir);
        assert.equal(checked[0], 0, checked[2].toString());
      }
      const asc = await fs.readFile("/workspace/first.asc");
      await writeFile(dir + "/first.asc", asc);
      await writeFile(dir + "/first", payload);
      for (const name of ["orphan.asc", "first.sig", "first.sign", "first.SIG", "first.gpg"]) {
        await writeFile(dir + "/" + name, asc);
        await fs.writeFile("/workspace/" + name, asc);
      }
      for (const [args, stdin] of [
        [["--verify", "first.asc"], "unrelated stdin"],
        [["--verify", "first.sig"], "unrelated stdin"],
        [["--no-tty", "--verify", "first.sign"], "unrelated stdin"],
        [["--verify", "first.SIG"], payload],
        [["--verify", "first.gpg"], payload],
        [["--batch", "--verify", "first.asc"], payload],
        [["--batch", "--no-batch", "--verify", "first.asc"], "unrelated stdin"],
        [["--verify"], asc],
        [["--verify"], ""],
        [["--verify", "orphan.asc"], payload],
        [["--batch", "--verify", "first.asc", "-"], "wrong"],
        [["--batch", "--verify", "-", "first"], asc],
      ] as const) {
        const expected = await runLinuxCommand("gpg", [...options.filter(x => x !== "--batch"), ...args], stdin, dir);
        const checked = await shell.exec("gpg " + args.join(" "), { stdin });
        assert.equal(checked.exitCode, expected[0], args.join(" ") + ": " + checked.stderr);
        if (expected[0] === 2) assert.equal(checked.stderr, expected[2].toString());
        if (!args.some(arg => arg === "--batch") && expected[0] === 0) assert.equal(checked.stderr.split("\n")[0], expected[2].toString().split("\n")[0]);
      }
      const own = await shell.exec("gpg --verify last.sig first last");
      assert.equal(own.exitCode, 0, own.stderr);
      assert.notEqual((await shell.exec("gpg --verify last.sig last first")).exitCode, 0);
      const failed = await shell.exec("gpg --status-fd=2 --detach-sign -o unavailable/sig first");
      assert.equal(failed.exitCode, 2);
      assert.ok(!failed.stderr.includes("SIG_CREATED"));
      const modified = await runLinuxCommand("gpg", [...options, "--verify", "signature.asc", "-"], "changed", dir);
      assert.notEqual(modified[0], 0);
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    rust.dispose();
    await ts.dispose();
  }
});

test("safe-bash imports GnuPG certificates and verifies a binary signature from an expired signing key", async () => {
  // gpg 2.4.4 --quick-gen-key at 2024-01-01T01:00Z, valid for one day;
  // gpg --detach-sign at 02:00Z. These fixtures contain no secret material.
  const expired = Buffer.from("mDMEZZIOkBYJKwYBBAHaRw8BAQdAomHKzF2VXegFot5vTx7YdBonCSuQOWPAGgaX6CtCi4C0HUZpeHR1cmUgPGZpeHR1cmVAZXhhbXBsZS5vcmc+iJkEExYKAEEWIQQ+6XPJzGFPQMXTbQpeuU5CiQ4JpwUCZZIOkAIbAwUJAAFRgAULCQgHAgIiAgYVCgkICwIEFgIDAQIeBwIXgAAKCRBeuU5CiQ4JpzcyAP9wT50czhZ94QRIKjlaSALxMUzW0rotTusmZYc8LyzqegEA6VUNv+brMtgYL2gAOdglxdWE389Zg9H0DAdoM479OQQ=", "base64");
  const signature = Buffer.from("iIoEABYKADIWIQQ+6XPJzGFPQMXTbQpeuU5CiQ4JpwUCZZIcoBQcZml4dHVyZUBleGFtcGxlLm9yZwAKCRBeuU5CiQ4Jp2EiAP9z76fxDSvQQJT0Zodnfp9fQdk7N+7YWJ1OJUSgUYJbYwEA3bvN5DP+WGg6tQP6rClsmgEL19kiSxy+6QGaGNhLbws=", "base64");
  const payload = "signed fixture\n";
  const rust = new RustWasmBash({ cwd: "/workspace", forceNative: true });
  const ts = await SafeBashE2EHarness.create({ fs: new sb.MemoryFileSystem() });
  let dir: string | undefined;
  try {
    dir = await createLinuxCommandDirectory(rust.fs);
    const home = dir + "/gnupg";
    await mkdir(home, { mode: 0o700 });
    const opts = ["--batch", "--no-autostart", "--no-options", "--homedir", home];
    for (const [cert, id] of [[gpgDistributionKey, "528897B826403ADA"], [expired, "5EB94E42890E09A7"]] as const) {
      const ref = await runLinuxCommand("gpg", [...opts, "--import"], cert, dir);
      assert.equal(ref[0], 0, ref[2].toString());
      const exported = await runLinuxCommand("gpg", [...opts, "--export", id], "", dir);
      assert.deepEqual(exported[1], cert);
      for (const shell of [rust, ts.shell]) {
        // Change a signed key-expiration subpacket but keep its length valid.
        const bad = Buffer.from(cert);
        const at = bad.indexOf(Buffer.from([5, 9]), 86);
        assert.ok(at > 0);
        bad[at + 5]! ^= 1;
        assert.notEqual((await shell.exec("gpg --import", { stdin: bad })).exitCode, 0);
        const res = await shell.exec("gpg --import", { stdin: cert });
        assert.equal(res.exitCode, 0, res.stderr);
        assert.deepEqual(Buffer.from((await shell.exec("gpg --export " + id)).stdoutBytes), exported[1]);
        const list = await runLinuxCommand("gpg", [...opts, "--list-keys", id], "", dir);
        assert.equal((await shell.exec("gpg --list-keys " + id)).stdout, list[1].toString());
        const cols = await runLinuxCommand("gpg", [...opts, "--with-colons", "--list-keys", id], "", dir);
        const fields = (text: string) => text.split("\n").filter(l => /^(pub|uid|fpr):/.test(l)).map(l => {
          const f = l.split(":");
          return f[0] === "pub" ? f.slice(0, 7) : [f[0], f[1], f[5], f[9]];
        });
        assert.deepEqual(fields((await shell.exec("gpg --with-colons --list-keys " + id)).stdout), fields(cols[1].toString()));
      }
    }
    await writeFile(dir + "/fixture.sig", signature);
    const expected = await runLinuxCommand("gpg", [...opts, "--status-fd=1", "--verify", "fixture.sig", "-"], payload, dir);
    assert.equal(expected[0], 0);
    const statuses = (s: string) => s.split("\n").filter(l => /^\[GNUPG:\] (?:GOODSIG|EXPKEYSIG|KEYEXPIRED|VALIDSIG) /u.test(l));
    assert.equal(statuses(expected[1].toString()).length, 3);
    for (const shell of [rust, ts.shell]) {
      await shell.exec("cat > /fixture.sig", { stdin: signature });
      const good = await shell.exec("gpg --status-fd=1 --verify /fixture.sig -", { stdin: payload });
      assert.equal(good.exitCode, expected[0], good.stderr);
      assert.deepEqual(statuses(good.stdout), statuses(expected[1].toString()));
      assert.match(good.stderr, /\[expired\]/);
      const bad = await shell.exec("gpg --status-fd=1 --verify /fixture.sig -", { stdin: "other" });
      assert.notEqual(bad.exitCode, 0);
      assert.deepEqual(statuses(bad.stdout), []);
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    rust.dispose();
    await ts.dispose();
  }
});
