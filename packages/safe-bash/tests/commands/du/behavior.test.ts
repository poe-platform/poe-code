import assert from "node:assert/strict";
import test from "node:test";
import { createDuCommand, createDuCommands, duCommands } from "../../../src/commands/du/index.js";
import { CommandRegistry, FsError, type FileStat } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { metadata, run, seed, shellRun, trace, wrapped } from "./helpers.js";

test("SI output uses decimal units and respects option order", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(1000));
  for (const [args, expected] of [
    [["--apparent-size", "--si"], "1.0k"],
    [["-h", "--si", "--apparent-size"], "1.0k"],
    [["--si", "-h", "--apparent-size"], "1000"],
    [["--si", "-b"], "1000"],
  ] as const) {
    const result = await shellRun(fs, [...args, "file"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${expected}\tfile\n`);
  }
});

test("threshold accepts zero with units but rejects negative zero", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  for (const value of ["0", "00", "0K", "00KiB", "0MB", "0Q"]) {
    for (const option of [["-t", value], [`--threshold=${value}`]]) {
      const result = await shellRun(fs, ["-ba", ...option, "tree"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "3\ttree/a\n5\ttree/sub/b\n5\ttree/sub\n8\ttree\n");
    }
    const result = await shellRun(fs, ["-ba", "-t", `-${value}`, "tree"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(`invalid --threshold argument '-${value}'`));
  }
  for (const value of ["human-readable", "si", "0wat", "-0wat"]) {
    assert.equal((await shellRun(fs, ["-t", value, "tree"])).exitCode, 1);
  }
});

test("exclusions match every component suffix, including patterns from files", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  await fs.writeFile("/exclude", new TextEncoder().encode("tree/sub\n"));
  for (const args of [["--exclude=tree/sub"], ["-X", "/exclude"]]) {
    const result = await shellRun(fs, ["-b", ...args, "/tree"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "3\t/tree\n");
  }
  assert.equal((await shellRun(fs, ["-b", "--exclude=sub/b", "/tree"])).stdout, "0\t/tree/sub\n3\t/tree\n");
});

test("exclusion brackets support POSIX classes, mixtures and negation", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/dir");
  for (const name of ["1", "a", "A", " ", "!", "z"]) await fs.writeFile(`/dir/${name}`, new Uint8Array(1));
  for (const [pattern, remaining] of [["[[:digit:]]", 5], ["[[:alpha:]]", 3], ["[[:digit:]a-z]", 3], ["[![:alpha:]]", 3], ["[[:space:][:punct:]]", 4]] as const) {
    const result = await shellRun(fs, ["-bs", `--exclude=${pattern}`, "/dir"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${remaining}\t/dir\n`);
  }
});

test("separate directories preserve complete own rows after subdirectory failure", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  for (const failed of ["/tree/sub", "/tree"]) {
    const fs = wrapped(base, { async readdir(path, options) {
      if (path === failed) throw new FsError("EACCES", { path });
      return base.readdir(path, options);
    } });
    const result = await shellRun(fs, ["-bSc", "/tree"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /permission denied/u);
    assert.equal(result.stdout, failed === "/tree/sub" ? "3\t/tree\n" : "");
  }
});

test("inode counts include directories and deduplicate hardlinks without allocation metadata", async () => {
  const fs = createMemoryFileSystem(); await seed(fs); await fs.link!("/tree/a", "/tree/alias");
  const result = await shellRun(fs, ["--inodes", "-ac", "tree"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\ttree/a\n1\ttree/sub/b\n2\ttree/sub\n4\ttree\n4\ttotal\n");
  assert.equal((await shellRun(fs, ["--inodes", "-sl", "tree"])).stdout, "5\ttree\n");
});

test("exclusions prune files, directories and explicit operands before metadata lookup", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  await fs.writeFile("/tree/b.skip", new Uint8Array(10));
  for (const args of [["-b", "--exclude=*.skip", "tree"], ["-b", "--exclude", "*.skip", "tree"]]) {
    const result = await shellRun(fs, args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "5\ttree/sub\n8\ttree\n");
  }
  const checked = trace(fs);
  assert.equal((await shellRun(checked.fs, ["-bc", "--exclude=sub", "--exclude=a", "--exclude=*.skip", "tree"])).stdout, "0\ttree\n0\ttotal\n");
  assert.ok(checked.calls.every(call => call.path === "/tree"));
  assert.equal((await shellRun(fs, ["-b", "--exclude=missing", "missing"])).exitCode, 0);
});

test("exclusion files, separate directories and signed thresholds", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  await fs.writeFile("/exclude", new TextEncoder().encode("a\n"));
  assert.equal((await shellRun(fs, ["-b", "-X", "exclude", "tree"])).stdout, "5\ttree/sub\n5\ttree\n");
  assert.equal((await shellRun(fs, ["-bSc", "tree"])).stdout, "5\ttree/sub\n3\ttree\n8\ttotal\n");
  assert.equal((await shellRun(fs, ["-ba", "-t5", "tree"])).stdout, "5\ttree/sub/b\n5\ttree/sub\n8\ttree\n");
  assert.equal((await shellRun(fs, ["-ba", "--threshold=-5", "tree"])).stdout, "3\ttree/a\n5\ttree/sub/b\n5\ttree/sub\n");
});

test("exclusion wildcards preserve escapes and bracket ranges within the work budget", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  for (const name of ["a.skip", "b.skip", "c.keep", "*.literal", "x.literal"]) await fs.writeFile(`/dir/${name}`, new Uint8Array(1));
  const result = await shellRun(fs, ["-bs", "--exclude=[ab].skip", "--exclude=\\*.literal", "dir"]);
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "2\tdir\n");
  assert.equal((await shellRun(fs, ["-bs", "--exclude=dir/?.skip", "dir"])).stdout, "3\tdir\n");
  assert.equal((await shellRun(fs, ["-bs", "--exclude=[!c]*", "dir"])).stdout, "");
  const bounded = await shellRun(fs, ["-b", "--exclude=*z*z*z", "dir"], {}, { limits: { maxSteps: 80 } });
  assert.equal(bounded.exitCode, 1); assert.match(bounded.stderr, /work.*limit/u);
});

test("dereference aliases follow operand or descendant links according to the selected mode", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  await fs.symlink!("tree", "/link"); await fs.symlink!("a", "/tree/sym");
  for (const flag of ["-D", "-H", "--dereference-args"]) {
    assert.equal((await shellRun(fs, ["-bs", flag, "link"])).stdout, "9\tlink\n");
  }
  assert.equal((await shellRun(fs, ["-bsL", "link"])).stdout, "8\tlink\n");
  assert.equal((await shellRun(fs, ["-bsLP", "link"])).stdout, "4\tlink\n");
  await fs.symlink!("..", "/tree/sub/cycle");
  const cycle = await shellRun(fs, ["-bL", "tree"]);
  assert.equal(cycle.exitCode, 1); assert.match(cycle.stderr, /cycle/u);
});

test("one filesystem skips foreign directories and refuses unknown device metadata", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  const foreign = metadata(fs, (stat, path) => ({ ...stat, dev: path.startsWith("/tree/sub") ? 2 : 1 }));
  assert.equal((await shellRun(foreign, ["-bx", "tree"])).stdout, "3\ttree\n");
  const unknown = metadata(fs, stat => {
    const copy = { ...stat }; delete copy.dev; return copy;
  });
  const result = await shellRun(unknown, ["-bx", "tree"]);
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /device.*unknown/u);
  for (const identityScope of [null, "untrusted"]) {
    const invalid = metadata(fs, stat => ({ ...stat, identityScope }) as unknown as FileStat);
    assert.equal((await shellRun(invalid, ["-bx", "tree"])).exitCode, 1);
  }
});

test("bracket exclusions preserve escaped closing brackets and hyphens", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/dir");
  for (const name of ["]", "-", "b"]) await fs.writeFile(`/dir/${name}`, new Uint8Array(1));
  for (const pattern of ["[\\]]", "[a\\-c]"]) {
    assert.equal((await shellRun(fs, ["-bs", `--exclude=${pattern}`, "dir"])).stdout, "2\tdir\n");
  }
});

test("command definition and plugin collision preflight preserve replacement policy", () => {
  assert.equal(createDuCommand().name, "du");
  assert.deepEqual(createDuCommands().map(command => command.name), ["du"]);
  const commands = new CommandRegistry([{ name: "du", execute: () => ({ exitCode: 42 }) }]);
  const original = commands.get("du");
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => duCommands().setup(host), /already registered/u);
  assert.equal(commands.get("du"), original);
  duCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("du"), original);
});

for (const [args, stdout] of [
  [["-b", "tree"], "5\ttree/sub\n8\ttree\n"],
  [["-bac", "tree"], "3\ttree/a\n5\ttree/sub/b\n5\ttree/sub\n8\ttree\n8\ttotal\n"],
  [["-bs", "tree"], "8\ttree\n"],
  [["-bad1", "tree"], "3\ttree/a\n5\ttree/sub\n8\ttree\n"],
  [["-bd0", "tree"], "8\ttree\n"],
  [["-bs", "-d", "0", "tree"], "8\ttree\n"],
  [["--bytes", "--all", "--null", "tree"], ["3\ttree/a", "5\ttree/sub/b", "5\ttree/sub", "8\ttree", ""].join("\0")],
] as const) {
  test(`actual Shell reporting ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem(); await seed(fs);
    const result = await shellRun(fs, args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
  });
}

test("known zero, unknown, and invalid allocation never fall back to logical size", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  for (const value of [undefined, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const fs = metadata(base, (stat, path) => path === "/tree/a" ? { ...stat, ...(value === undefined ? {} : { allocatedBytes: value }) } : { ...stat, allocatedBytes: 0 });
    const result = await shellRun(fs, ["-ac", "tree"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /allocated bytes (unknown|invalid)/u);
    assert.equal(result.stdout, "0\ttree/sub/b\n0\ttree/sub\n");
    assert.equal((await shellRun(fs, ["-bs", "tree"])).stdout, "8\ttree\n");
  }
  const measured = metadata(base, stat => ({ ...stat, allocatedBytes: 0 }));
  assert.equal((await shellRun(measured, ["-sc", "tree"])).stdout, "0\ttree\n0\ttotal\n");
});

test("unknown directory allocation preserves known descendants but suppresses ancestors", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const fs = metadata(base, (stat, path) => path === "/tree" ? stat : { ...stat, allocatedBytes: 1024 });
  const result = await shellRun(fs, ["-ac", "tree"]);
  assert.equal(result.stdout, "1\ttree/a\n1\ttree/sub/b\n2\ttree/sub\n");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /tree.*allocated bytes unknown/u);
});

test("apparent directories contribute zero, final symlinks contribute their own length", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  await base.symlink!("tree", "/link"); await base.symlink!("absent", "/broken");
  const checked = trace(metadata(base, stat => stat.type === "directory" ? { ...stat, size: NaN } : stat));
  const result = await shellRun(checked.fs, ["-bc", "tree", "link", "broken"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "5\ttree/sub\n8\ttree\n4\tlink\n6\tbroken\n18\ttotal\n");
  assert.ok(checked.calls.every(call => call.method === "lstat" || call.method === "readdir"));
  assert.ok(checked.calls.every(call => call.signal instanceof AbortSignal));
});

test("invocation-wide hardlink dedup uses complete scoped identity; count-links overrides", async () => {
  const fs = createMemoryFileSystem(); await seed(fs); await fs.link!("/tree/a", "/alias");
  assert.equal((await shellRun(fs, ["-bc", "tree/a", "alias"])).stdout, "3\ttree/a\n3\ttotal\n");
  assert.equal((await shellRun(fs, ["-blc", "tree/a", "alias"])).stdout, "3\ttree/a\n3\talias\n6\ttotal\n");
  for (const fields of [{ identityScope: undefined }, { dev: -1 }, { ino: 0.5 }, { ino: Number.MAX_SAFE_INTEGER + 1 }, { identityScope: "untrusted" }]) {
    const unknown = metadata(fs, stat => ({ ...stat, ...fields }) as FileStat);
    assert.equal((await shellRun(unknown, ["-bc", "tree/a", "alias"])).stdout, "3\ttree/a\n3\talias\n6\ttotal\n");
  }
  for (const scope of [{}, Symbol("equal-description")]) {
    const identities = metadata(fs, (stat, path) => ({ ...stat, identityScope: path === "/alias" ? typeof scope === "symbol" ? Symbol("equal-description") : {} : scope, dev: 0, ino: 0 }));
    assert.equal((await shellRun(identities, ["-bc", "tree/a", "alias"])).stdout, "3\ttree/a\n3\talias\n6\ttotal\n");
  }
});

test("repeated directories are traversed, not globally pruned by identity", async () => {
  const fs = createMemoryFileSystem(); await seed(fs);
  const result = await shellRun(fs, ["-bc", "tree", "tree"]);
  assert.equal(result.stdout, "5\ttree/sub\n8\ttree\n0\ttree/sub\n0\ttree\n8\ttotal\n");
});

test("known identity never hides an unknown allocation observation on a later alias", async () => {
  const base = createMemoryFileSystem(); await seed(base); await base.link!("/tree/a", "/alias");
  const fs = metadata(base, (stat, path) => path === "/alias" ? stat : { ...stat, allocatedBytes: 512 });
  const result = await shellRun(fs, ["-cB1", "tree/a", "alias"]);
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "512\ttree/a\n");
  assert.match(result.stderr, /alias.*allocated bytes unknown/u);
});

test("literal names, --, stable sort, missing and empty operands preserve useful output", async () => {
  const fs = createMemoryFileSystem();
  for (const name of ["z", "a", "-", "-h", "line\nfeed", "tab\tname"]) await fs.writeFile(`/${name}`, new Uint8Array(1));
  assert.equal((await shellRun(fs, ["-b", "--", "-h", "-"])).stdout, "1\t-h\n1\t-\n");
  assert.equal((await shellRun(fs, ["-b0", "line\nfeed", "tab\tname"])).stdout, "1\tline\nfeed\0" + "1\ttab\tname\0");
  const result = await shellRun(fs, ["-bc", "missing", "", "./a"]);
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "1\t./a\n");
  assert.match(result.stderr, /missing/u);
  assert.match(result.stderr, /no such file or directory/u);
  const ordered = await shellRun(fs, ["-ba", "/"]);
  assert.ok(ordered.stdout.indexOf("/-h\n") < ordered.stdout.indexOf("/a\n"));
  assert.ok(ordered.stdout.indexOf("/a\n") < ordered.stdout.indexOf("/z\n"));
});

test("invalid arguments fail before filesystem calls; selected invalid environment falls back", async () => {
  const checked = trace(createMemoryFileSystem());
  for (const args of [["tree", "--bad"], ["-B"], ["--block-size="], ["-B1.1K"], ["-B0"], ["-B9007199254740992"], ["-d-1"], ["-d1.5"], ["-s", "-d2"], ["-as"], ["--all=yes"], ["--exclude"], ["-X"], ["-t"], ["-tbad"], ["a\0b"]]) {
    const result = await run(args, {}, { fs: checked.fs });
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.equal(result.stdout, "");
  }
  assert.equal(checked.calls.length, 0);
  const base = createMemoryFileSystem(); await base.writeFile("/file", new Uint8Array(1025));
  for (const env of [{ DU_BLOCK_SIZE: "bad" }, { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1" }]) {
    const fallback = trace(base);
    const result = await run(["--apparent-size", "file"], {}, { fs: fallback.fs, env });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "2\tfile\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(fallback.calls.map(call => [call.method, call.path]), [["lstat", "/file"]]);
  }
});

test("context environment precedence and explicit formatting remain local", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/file", new Uint8Array(1025));
  for (const [env, expected] of [[{}, "2"], [{ POSIXLY_CORRECT: "" }, "3"], [{ BLOCKSIZE: "2K" }, "1"], [{ BLOCK_SIZE: "1", BLOCKSIZE: "2K" }, "1025"], [{ DU_BLOCK_SIZE: "K", BLOCK_SIZE: "1" }, "2K"]] as const) {
    assert.equal((await run(["--apparent-size", "file"], {}, { fs, env })).stdout, `${expected}\tfile\n`);
  }
  assert.equal((await run(["-bhk", "file"], {}, { fs, env: { DU_BLOCK_SIZE: "bad" } })).stdout, "2\tfile\n");
  assert.equal((await run(["-bk", "-B1", "file"], {}, { fs })).stdout, "1025\tfile\n");
});

test("checked aggregation and invalid logical size suppress incomplete totals", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const fs = metadata(base, stat => ({ ...stat, size: Number.MAX_SAFE_INTEGER }));
  const result = await shellRun(fs, ["-bac", "tree"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, `${Number.MAX_SAFE_INTEGER}\ttree/a\n${Number.MAX_SAFE_INTEGER}\ttree/sub/b\n${Number.MAX_SAFE_INTEGER}\ttree/sub\n`);
  assert.match(result.stderr, /aggregate exceeds safe integer/u);
  const invalid = metadata(base, stat => ({ ...stat, size: -1 }));
  assert.equal((await shellRun(invalid, ["-bsc", "tree"])).stdout, "");
  const separate = await shellRun(fs, ["-b", "tree/a", "tree/sub/b"]);
  assert.equal(separate.exitCode, 0, separate.stderr);
  assert.equal(separate.stdout, `${Number.MAX_SAFE_INTEGER}\ttree/a\n${Number.MAX_SAFE_INTEGER}\ttree/sub/b\n`);
});

test("typed listing errors propagate meaning and preserve known unrelated operands", async () => {
  const base = createMemoryFileSystem(); await seed(base);
  const fs = wrapped(base, { async readdir() { throw new FsError("EACCES", { path: "/tree", syscall: "readdir" }); } });
  const result = await shellRun(fs, ["-bc", "tree", "tree/a"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "3\ttree/a\n");
  assert.match(result.stderr, /permission denied.*readdir.*tree/u);
});
