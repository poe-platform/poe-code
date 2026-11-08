import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { metadata, run, seed, trace } from "./test-helpers.js";

test("visited directories are counted once across repeated and overlapping operands", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  for (const [args, stdout] of [
    [["-bc", "tree", "tree"], "5\ttree/sub\n8\ttree\n8\ttotal\n"],
    [["-bc", "tree/sub", "tree"], "5\ttree/sub\n3\ttree\n8\ttotal\n"],
    [["--inodes", "-c", "tree", "tree"], "2\ttree/sub\n4\ttree\n4\ttotal\n"],
    [["--inodes", "-c", "tree/sub", "tree"], "2\ttree/sub\n2\ttree\n4\ttotal\n"],
  ] as const) {
    const checked = trace(fs);
    const result = await run(args, {}, { fs: checked.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.equal(checked.calls.filter(call => call.method === "readdir" && call.path === "/tree/sub").length, 1);
  }
});

test("count-links retains repeated directory traversal and inode totals", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  for (const flag of ["-l", "--count-links"]) {
    const result = await run(["--inodes", "-c", flag, "tree", "tree"], {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2\ttree/sub\n4\ttree\n2\ttree/sub\n4\ttree\n8\ttotal\n");
  }
});

test("unknown directory identities remain independently countable", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const fs = metadata(base, stat => { const { identityScope: ignoredScope, ...rest } = stat; return rest; });
  const result = await run(["--inodes", "-c", "tree", "tree"], {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "2\ttree/sub\n4\ttree\n2\ttree/sub\n4\ttree\n8\ttotal\n");
});

test("equal inode numbers in distinct identity scopes or devices stay independent", async () => {
  const base = createMemoryFileSystem();
  await base.mkdir("/first"); await base.mkdir("/second");
  const first = {}, second = {};
  for (const differentScope of [true, false]) {
    const fs = metadata(base, (stat, path) => ({ ...stat, ino: 0,
      identityScope: differentScope && path === "/second" ? second : first,
      dev: !differentScope && path === "/second" ? 1 : 0 }));
    const result = await run(["--inodes", "-c", "first", "second"], {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1\tfirst\n1\tsecond\n2\ttotal\n");
  }
});

test("followed directory aliases deduplicate while ancestor cycles still fail", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  await fs.symlink!("/tree", "/alias");
  const result = await run(["-Lbc", "tree", "alias"], {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "5\ttree/sub\n8\ttree\n8\ttotal\n");
  await fs.symlink!("/tree", "/tree/sub/cycle");
  for (const flags of ["-Lbc", "-Llbc"]) {
    const cycle = await run([flags, "tree"], {}, { fs });
    assert.equal(cycle.exitCode, 1);
    assert.ok(cycle.stderr.includes("directory cycle detected"));
    assert.ok(!cycle.stdout.includes("\ttotal\n"));
  }
});

test("SI formatting, signed positive thresholds and negative zero remain supported", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  for (const [args, stdout] of [
    [["-b", "--si", "file"], "1.1k\tfile\n"],
    [["--si", "-b", "file"], "1025\tfile\n"],
    [["-b", "-t", "+1K", "file"], "1025\tfile\n"],
    [["-b", "--threshold=+1026", "file"], ""],
  ] as const) {
    const result = await run(args, {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
  }
  for (const args of [["-t", "-0"], ["--threshold=-0"], ["-t", "-0K"]]) {
    const checked = trace(fs);
    const result = await run(args, {}, { fs: checked.fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("invalid --threshold argument"));
    assert.equal(checked.calls.length, 0);
  }
});
