import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";

test("GNU diff and patch exchange unified diffs with TypeScript and Rust", async () => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "gnu-diff-");
  const ts = await SafeBashE2EHarness.create({ env, fs: new sb.MemoryFileSystem() });
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
