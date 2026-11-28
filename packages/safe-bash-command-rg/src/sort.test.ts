import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";
import { parse, ParsedArguments } from "./options.js";

for (const fast of [false, true]) {
  for (const key of ["none", "path", "modified", "accessed", "created"]) {
    for (const reverse of [false, true]) {
      test(`sort ${key}, reverse=${reverse}, fast=${fast}`, async (t) => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work");
        t.mock.method(Date, "now", () => 1000);
        await fs.writeFile("/work/b", Buffer.from("x\n"));
        t.mock.method(Date, "now", () => 2000);
        await fs.writeFile("/work/a", Buffer.from("x\n"));
        for (const mode of ["-l", "-c", "-n", "--files"]) {
          await fs.utimes("/work/b", 1000, 1000);
          await fs.utimes("/work/a", 2000, 2000);
          const flags = reverse || key === "accessed" ? [`--${reverse ? "sortr" : "sort"}=${key}`] : ["--sort", key];
          const values = createCommandArguments([...flags, mode, ...(mode === "--files" ? [] : ["x"])]);
          let stdout = "", stderr = "";
          const result = await createRgCommand().execute({
            command: "rg", args: values.args, argumentValues: values, cwd: "/work", env: {}, fs,
            ...(fast ? { _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true } : {}),
            stdin: toByteSource(""), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          });
          assert.equal(stderr, "");
          assert.equal(result.exitCode, 0);
          const names = key === "path" || key === "none" ? ["a", "b"] : ["b", "a"];
          if (reverse && key !== "none") names.reverse();
          const lines = stdout.trim().split("\n");
          if (key === "none") lines.sort();
          assert.deepEqual(lines, names.map(name => mode === "-c" ? `${name}:1` : mode === "-n" ? `${name}:1:x` : name));
        }
      });
    }
  }
}

test("sort validates values, last flag wins and reused arguments reset", () => {
  for (const flag of ["--sort", "--sortr"]) {
    assert.throws(() => parse([flag, "invalid", "x"]));
    assert.throws(() => parse(["x", flag]));
  }
  const target = new ParsedArguments();
  assert.equal(parse(["--sortr=modified", "--sort=accessed", "x"], target).sort, "accessed");
  assert.equal(target.sortReverse, false);
  assert.equal(parse(["--sort=path", "--sortr=created", "x"], target).sortReverse, true);
  assert.equal(parse(["x"], target).sort, "none");
  assert.equal(target.sortReverse, false);
});

test("timestamp sorting preserves recursive traversal, filters and file limits", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work/sub", { recursive: true });
  for (const name of ["a", "b", "sub/z", "sub/y", "ignored"]) {
    await fs.writeFile(`/work/${name}`, Buffer.from("x\n"));
  }
  await fs.writeFile("/work/.ignore", Buffer.from("ignored\n"));
  for (const [index, name] of ["b", "sub", "a", "sub/z", "sub/y"].entries()) {
    await fs.utimes(`/work/${name}`, index, index);
  }
  for (const reverse of [false, true]) {
    for (const maxFiles of [100, 2]) {
      const values = createCommandArguments([reverse ? "--sortr=modified" : "--sort=modified", "-l", "x"]);
      let stdout = "", stderr = "";
      const result = await createRgCommand({ maxFiles }).execute({
        command: "rg", args: values.args, argumentValues: values, cwd: "/work", env: {}, fs,
        ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true },
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      if (maxFiles === 2) {
        assert.equal(result.exitCode, 2);
        assert.match(stderr, /filesystem entry limit exceeded/);
      } else {
        assert.equal(result.exitCode, 0);
        assert.equal(stderr, "");
        assert.equal(stdout, reverse ? "a\nsub/y\nsub/z\nb\n" : "b\nsub/z\nsub/y\na\n");
      }
    }
  }
});

for (const flag of ["--sort", "--sortr"]) {
  for (const key of ["none", "path", "modified", "accessed", "created"]) {
    for (const inline of [false, true]) {
      test(`${flag} ${key}, inline=${inline}`, async (t) => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work");
        const clock = t.mock.method(Date, "now");
        for (const [name, created, accessed, modified] of [
          ["b", 3000, 1000, 2000], ["a", 2000, 3000, 1000], ["c", 1000, 2000, 3000],
        ] as const) {
          clock.mock.mockImplementation(() => created);
          await fs.writeFile(`/work/${name}`, new TextEncoder().encode("x\n"));
          await fs.utimes(`/work/${name}`, accessed, modified);
        }
        clock.mock.restore();
        const values = createCommandArguments([...(inline ? [`${flag}=${key}`] : [flag, key]), "-c", "x"]);
        let stdout = "", stderr = "";
        const context: CommandContext & { _fastMemoryBackingFs: typeof fs; _hasInfiniteFsOpsLimit: boolean } = {
          command: "rg", args: values.args, argumentValues: values, fs, cwd: "/work", env: {},
          _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
          stdin: toByteSource(""), signal: new AbortController().signal,
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        };
        const result = await createRgCommand().execute(context);
        assert.equal(stderr, "");
        assert.equal(result.exitCode, 0);
        const expected = key === "accessed" ? ["b", "c", "a"] : key === "created" ? ["c", "a", "b"] : ["a", "b", "c"];
        if (flag === "--sortr" && key !== "none") expected.reverse();
        const actual = stdout.trim().split("\n");
        assert.deepEqual(key === "none" ? actual.sort() : actual, expected.map(name => `${name}:1`));
      });
    }
  }
}

test("sort flags override one another and reset between invocations", () => {
  assert.equal(parse(["x"]).sort, "none");
  assert.equal(parse(["x"]).sortReverse, false);
  const target = new ParsedArguments();
  parse(["--sortr=created", "--sort=modified", "x"], target);
  assert.equal(target.sort, "modified");
  assert.equal(target.sortReverse, false);
  parse(["--sort=modified", "--sortr=path", "x"], target);
  assert.equal(target.sort, "path");
  assert.equal(target.sortReverse, true);
  parse(["x"], target);
  assert.equal(target.sort, "none");
  assert.equal(target.sortReverse, false);
  for (const flag of ["--sort", "--sortr"]) {
    assert.throws(() => parse([`${flag}=bogus`, "x"]), /sort/);
    assert.throws(() => parse(["x", flag]), /requires a value/);
  }
});

for (const missingBirthTime of [false, true]) {
  test(`timestamp sorting rejects unavailable metadata and obeys file limits (missingBirthTime=${missingBirthTime})`, async (t) => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    for (const name of ["a", "b"]) await fs.writeFile(`/work/${name}`, new Uint8Array());
    if (missingBirthTime) {
      const stat = fs.stat.bind(fs);
      t.mock.method(fs, "stat", async (...args: Parameters<typeof stat>) => {
        const result = await stat(...args);
        Reflect.deleteProperty(result, "birthtimeMs");
        return result;
      });
    }
    const values = createCommandArguments(["--files", "--sort=created"]);
    let stdout = "", stderr = "";
    const result = await createRgCommand(missingBirthTime ? {} : { maxFiles: 2 }).execute({
      command: "rg", args: values.args, argumentValues: values, fs, cwd: "/work", env: {},
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 2);
    assert.equal(stdout, "");
    assert.match(stderr, missingBirthTime ? /created time is unavailable/ : /filesystem entry limit exceeded/);
  });
}
