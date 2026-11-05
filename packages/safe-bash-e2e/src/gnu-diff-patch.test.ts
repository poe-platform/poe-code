import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness } from "./harness.js";

test("GNU diff and patch exchange unified diffs with TypeScript and Rust", async () => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "gnu-diff-");
  const ts = await SafeBashE2EHarness.create({ env, backend: "typescript" });
  const rust = new RustWasmBash({ env, cwd: "/workspace", forceNative: true });
  const backends = [
    [ts.shell, ts.fs],
    [rust, rust.fs]
  ] as const;
  const native = (command: string, args: string[]) =>
    spawnSync("/usr/bin/" + command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    for (const [before, after] of [
      ["", "new line\n"],
      ["-- old path\n", "++ new path\n"],
      ["café\nend", "café\nlast"],
      ["a\r\nb\r\n", "a\r\nc\r\n"],
      ["old\none\ntwo\nthree\nfour\nfive\nlast\n", "new\none\ntwo\nthree\nfour\nfive\nlast"]
    ] as const) {
      await writeFile(cwd + "/before", before);
      await writeFile(cwd + "/after", after);
      const args = ["-U1", "--label", "before", "--label", "after", "before", "after"];
      const reference = native("diff", args);
      assert.equal(reference.status, 1, reference.stderr.toString());
      for (const [shell, view] of backends) {
        await view.writeFile("/workspace/before", Buffer.from(before));
        await view.writeFile("/workspace/after", Buffer.from(after));
        const generated = await shell.exec("diff " + args.join(" "));
        assert.equal(generated.exitCode, reference.status, generated.stderr);
        assert.deepEqual(Buffer.from(generated.stderrBytes), reference.stderr);
        assert.deepEqual(
          Buffer.from(generated.stdoutBytes),
          reference.stdout,
          shell.constructor.name + ": " + JSON.stringify(before)
        );
        await writeFile(cwd + "/delta", generated.stdoutBytes);
        await writeFile(cwd + "/work", before);
        const applied = native("patch", ["--batch", "-i", "delta", "work"]);
        assert.equal(applied.status, 0, applied.stderr.toString());
        assert.deepEqual(await readFile(cwd + "/work"), Buffer.from(after));
        await view.writeFile("/workspace/work", Buffer.from(before));
        const imported = await shell.exec("patch --batch work", { stdin: reference.stdout });
        assert.equal(imported.exitCode, applied.status, imported.stderr);
        assert.deepEqual(Buffer.from(imported.stdoutBytes), applied.stdout);
        assert.deepEqual(Buffer.from(imported.stderrBytes), applied.stderr);
        assert.deepEqual(
          Buffer.from(await view.readFile("/workspace/work")),
          Buffer.from(after),
          shell.constructor.name
        );
      }
    }
    // Safe Bash admits UTF-8 patch text; a rejected byte stream must never change target bytes.
    for (const [shell, view] of backends) {
      const valid = Buffer.from("keep \uE080\nold\n");
      const edited = Buffer.from("keep \uE080\nnew\n");
      const delta = Buffer.from("--- work\n+++ work\n@@ -1,2 +1,2 @@\n keep \uE080\n-old\n+new\n");
      for (const [byte, reason] of [[0xff, "invalid UTF-8"], [0, "NUL byte"]] as const) {
        for (const badPatch of [false, true]) {
          const corrupted = Buffer.from([byte, 10]);
          const initial = badPatch ? valid : Buffer.concat([corrupted, valid]);
          const payload = badPatch ? Buffer.concat([delta, corrupted]) : delta;
          for (const named of [false, true]) {
            await view.writeFile("/workspace/work", initial);
            await view.writeFile("/workspace/delta", payload);
            const result = await shell.exec("patch --batch --atomic " + (named ? "-i delta " : "") + "work", { stdin: named ? "" : payload });
            assert.equal(result.exitCode, 2, shell.constructor.name + ": " + result.stdout + result.stderr);
            assert.match(result.stderr, new RegExp(reason));
            assert.deepEqual(Buffer.from(await view.readFile("/workspace/work")), initial);
          }
        }
      }
      const invalid = Buffer.from([0xff, 10]);
      await view.writeFile("/workspace/work", invalid);
      const create = await shell.exec("patch --batch work", { stdin: "--- /dev/null\n+++ work\n@@ -0,0 +1 @@\n+new\n" });
      assert.equal(create.exitCode, 2, create.stdout + create.stderr);
      assert.deepEqual(Buffer.from(await view.readFile("/workspace/work")), invalid);
      await view.writeFile("/workspace/work", valid);
      await view.writeFile("/workspace/existing-output", invalid);
      const redirected = await shell.exec("patch --batch -o existing-output work", { stdin: delta });
      assert.equal(redirected.exitCode, 2, redirected.stdout + redirected.stderr);
      assert.deepEqual(Buffer.from(await view.readFile("/workspace/existing-output")), invalid);
      await view.writeFile("/workspace/later", invalid);
      const atomic = await shell.exec("patch --batch --atomic", { stdin: Buffer.concat([
        delta, Buffer.from("--- later\n+++ later\n@@ -1 +1 @@\n-old\n+new\n"),
      ]) });
      assert.equal(atomic.exitCode, 2, atomic.stdout + atomic.stderr);
      assert.deepEqual(Buffer.from(await view.readFile("/workspace/work")), valid);
      assert.deepEqual(Buffer.from(await view.readFile("/workspace/later")), invalid);
      await writeFile(cwd + "/work", valid);
      await writeFile(cwd + "/delta", delta);
      const reference = native("patch", ["--batch", "-i", "delta", "work"]);
      assert.equal(reference.status, 0, reference.stderr.toString());
      assert.deepEqual(await readFile(cwd + "/work"), edited);
      for (const flags of [[], ["--atomic"], ["-o", "-"]]) {
        await view.writeFile("/workspace/work", valid);
        const result = await shell.exec("patch --batch " + flags.join(" ") + " work", { stdin: delta });
        assert.equal(result.exitCode, 0, result.stderr);
        if (flags.includes("-o")) assert.deepEqual(Buffer.from(result.stdoutBytes), edited);
        assert.deepEqual(Buffer.from(await view.readFile("/workspace/work")), flags.includes("-o") ? valid : edited);
      }
    }
    for (const delta of [
      "--- work\n+++ work\n@@ -1 +1 @@\n-a\n+b\n",
      "1c1\n< a\n---\n> b\n",
      "*** work\n--- work\n***************\n*** 1 ****\n! a\n--- 1 ----\n! b\n"
    ]) {
      const transported = Buffer.from(delta.replaceAll("\n", "\r\n"));
      await writeFile(cwd + "/delta", transported);
      for (const flags of [["--binary"], [], ["-s"]]) {
        const eol = flags.includes("--binary") ? "\r\n" : "\n";
        await writeFile(cwd + "/work", "a" + eol);
        const args = ["--batch", ...flags, "-i", "delta", "work"];
        const reference = native("patch", args);
        assert.equal(reference.status, 0, reference.stderr.toString());
        const expected = await readFile(cwd + "/work");
        assert.deepEqual(expected, Buffer.from("b" + eol));
        for (const [shell, view] of backends) {
          await view.writeFile("/workspace/work", Buffer.from("a" + eol));
          await view.writeFile("/workspace/delta", transported);
          const result = await shell.exec("patch " + args.join(" "));
          const label =
            shell.constructor.name + ": " + args.join(" ") + ": " + delta.split("\n")[0];
          assert.equal(
            result.exitCode,
            reference.status,
            label + ": " + result.stdout + result.stderr
          );
          assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, label);
          assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr, label);
          assert.deepEqual(Buffer.from(await view.readFile("/workspace/work")), expected, label);
        }
      }
    }
    const original = "delete first\ndelete second\nkeep\nlast\n";
    const edited = "keep\nnew first\nnew second\nlast";
    await writeFile(cwd + "/before", original);
    await writeFile(cwd + "/after", edited);
    const normal = native("diff", ["before", "after"]);
    assert.equal(normal.status, 1, normal.stderr.toString());
    await writeFile(cwd + "/delta", normal.stdout);
    for (const reverse of [false, true]) {
      const before = reverse ? edited : original;
      await writeFile(cwd + "/work", before);
      const args = ["--batch", ...(reverse ? ["-R"] : []), "-i", "delta", "work"];
      const reference = native("patch", args);
      assert.equal(reference.status, 0, reference.stderr.toString());
      for (const [shell, view] of backends) {
        await view.writeFile("/workspace/work", Buffer.from(before));
        await view.writeFile("/workspace/delta", normal.stdout);
        const result = await shell.exec("patch " + args.join(" "));
        assert.equal(result.exitCode, reference.status, result.stdout + result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
        assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
        assert.deepEqual(
          Buffer.from(await view.readFile("/workspace/work")),
          await readFile(cwd + "/work")
        );
      }
    }
    for (const before of [
      "a\nx\na\nx\nx\nx\nx\na\n", // A nearer match before the requested line.
      "a\nx\na\nx\na\nx\n", // Equal distances: GNU tries the later line first.
      "a\na\nx\nx\nx\n" // No later match: try earlier lines nearest first.
    ]) {
      const delta = "4c4\n< a\n---\n> A\n";
      await writeFile(cwd + "/delta", delta);
      await writeFile(cwd + "/work", before);
      const args = ["--batch", "-i", "delta", "work"];
      const reference = native("patch", args);
      assert.equal(reference.status, 0, reference.stderr.toString());
      for (const [shell, view] of backends) {
        await view.writeFile("/workspace/work", Buffer.from(before));
        await view.writeFile("/workspace/delta", Buffer.from(delta));
        const result = await shell.exec("patch " + args.join(" "));
        assert.equal(result.exitCode, reference.status, result.stdout + result.stderr);
        assert.deepEqual(
          Buffer.from(await view.readFile("/workspace/work")),
          await readFile(cwd + "/work"),
          shell.constructor.name
        );
        assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
        assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
      }
    }
    const missingLF = "\\ No newline at end of file\n";
    for (const [n, [before, delta, flags, code]] of (
      [
        ["a\n", "1c1\n< a\n" + missingLF + "---\n> b\n", [], 1],
        ["a", "1c1\n< a\n---\n> b\n", [], 1],
        ["x\n", "1c1\n< a\n---\n> b\n" + missingLF, ["--reject-format=unified"], 1],
        ["x\n", "1c1\n< a\n---\n> b\n" + missingLF, [], 1],
        ["a\na", "1c1\n< a\n" + missingLF + "---\n> b\n", [], 0],
        ["a\nz", "1c1\n< a\n---\n> b\n" + missingLF, [], 0],
        ["a", "1c1\n< a\n---\n> b\n", ["-l"], 0],
        ["a\r\n", "1c1\n< a \r\n---\n> b\n", ["-l"], 1],
        ["left\u00a0right\n", "1c1\n< left right\n---\n> b\n", ["-l"], 1],
        [" a\n", "1c1\n< a\n---\n> b\n", ["-l"], 1],
        ["\ta\t  b  ", "1c1\n<   a b\n---\n> c\n", ["-l"], 0],
        ["old\ntail", "--- w\n+++ w\n@@ -1,2 +1,2 @@\n-old\n+new\n tail\n", ["-l"], 0],
        ["b", "1c1\n< a\n---\n> b\n" + missingLF, ["-R"], 0]
      ] as const
    ).entries()) {
      const name = "eof" + n;
      await writeFile(cwd + "/" + name, before);
      await writeFile(cwd + "/delta", delta);
      const args = ["--batch", ...flags, "-i", "delta", name];
      const reference = native("patch", args);
      assert.equal(
        reference.status,
        code,
        reference.stdout.toString() + reference.stderr.toString()
      );
      for (const [shell, view] of backends) {
        await view.writeFile("/workspace/" + name, Buffer.from(before));
        await view.writeFile("/workspace/delta", Buffer.from(delta));
        const result = await shell.exec("patch " + args.join(" "));
        assert.equal(
          result.exitCode,
          code,
          shell.constructor.name + ": " + name + ": " + result.stdout
        );
        assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
        assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
        for (const suffix of code === 1 ? ["", ".rej", ".orig"] : [""]) {
          assert.deepEqual(
            Buffer.from(await view.readFile("/workspace/" + name + suffix)),
            await readFile(cwd + "/" + name + suffix),
            name + suffix
          );
        }
      }
    }
    // A failed normal hunk still allows later matching hunks to apply.
    for (const [name, flags, indexed] of [
      ["partial", [], false],
      ["indexed", ["--reject-format=unified"], true]
    ] as const) {
      const before = "x\ny\nc\n";
      const delta =
        (indexed ? "Index: " + name + "\n" : "") + "1c1\n< a\n---\n> A\n3c3\n< c\n---\n> C\n";
      await writeFile(cwd + "/" + name, before);
      await writeFile(cwd + "/delta", delta);
      const args = ["--batch", ...flags, "-i", "delta", ...(indexed ? [] : [name])];
      const reference = native("patch", args);
      assert.equal(reference.status, 1, reference.stderr.toString());
      for (const [shell, view] of backends) {
        await view.writeFile("/workspace/" + name, Buffer.from(before));
        await view.writeFile("/workspace/delta", Buffer.from(delta));
        const result = await shell.exec("patch " + args.join(" "));
        assert.equal(
          result.exitCode,
          reference.status,
          shell.constructor.name + ": " + result.stdout
        );
        assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
        assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
        for (const suffix of ["", ".orig", ".rej"]) {
          assert.deepEqual(
            Buffer.from(await view.readFile("/workspace/" + name + suffix)),
            await readFile(cwd + "/" + name + suffix)
          );
        }
      }
    }
    const pair = ["first", "second"]
      .map((name) => `--- ${name}\r\n+++ ${name}\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n`)
      .join("");
    await writeFile(cwd + "/delta", pair);
    for (const name of ["first", "second"]) await writeFile(cwd + "/" + name, "a\n");
    const args = ["--batch", "-o", "-", "-i", "delta"];
    const streamed = native("patch", args);
    assert.equal(streamed.status, 0, streamed.stderr.toString());
    for (const [shell, view] of backends) {
      for (const name of ["first", "second"])
        await view.writeFile("/workspace/" + name, Buffer.from("a\n"));
      await view.writeFile("/workspace/delta", Buffer.from(pair));
      const result = await shell.exec("patch " + args.join(" "));
      assert.equal(result.exitCode, streamed.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), streamed.stdout);
      assert.deepEqual(Buffer.from(result.stderrBytes), streamed.stderr, shell.constructor.name);
    }
  } finally {
    await ts.dispose();
    await rust.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
