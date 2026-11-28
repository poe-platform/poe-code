import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createCpCommand } from "./index.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/source", new TextEncoder().encode("x\n"));
  await fs.utimes("/work/source", 2000, 2000);
  return fs;
}

async function run(fs: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  let stdout = "", stderr = "";
  const result = await createCpCommand().execute({
    command: "cp", args, fs, cwd: "/work", env: {}, signal: new AbortController().signal,
    stdin: toByteSource(""),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stdout, stderr };
}

for (const mode of ["none", "older", "all"]) {
  for (const time of [undefined, 1000, 2000, 3000]) {
    test(`cp --update=${mode} with destination time ${time}`, async () => {
      const fs = await fixture();
      if (time !== undefined) {
        await fs.writeFile("/work/target", new TextEncoder().encode("y\n"));
        await fs.utimes("/work/target", time, time);
      }
      const copied = time === undefined || mode === "all" || mode === "older" && time < 2000;
      assert.deepEqual(await run(fs, [`--update=${mode}`, "-v", "source", "target"]), {
        exitCode: 0, stderr: "", stdout: copied ? "'source' -> 'target'\n" : "",
      });
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), copied ? "x\n" : "y\n");
      if (!copied) assert.equal((await fs.stat("/work/target")).mtimeMs, time);
    });
  }
}

for (const args of [["--update=none", "--update=all"], ["--update=none", "-u"], ["--update=none", "--update"]]) {
  test(`cp applies update options in order: ${args.join(" ")}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/target", new TextEncoder().encode("y\n"));
    await fs.utimes("/work/target", 1000, 1000);
    assert.deepEqual(await run(fs, [...args, "source", "target"]), { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(await fs.readFile("/work/target"), await fs.readFile("/work/source"));
  });
}

test("cp --update=none traverses existing directories without overwriting their files", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/from");
  await fs.mkdir("/work/to");
  await fs.writeFile("/work/from/existing", new TextEncoder().encode("x"));
  await fs.writeFile("/work/from/missing", new TextEncoder().encode("new"));
  await fs.writeFile("/work/to/existing", new TextEncoder().encode("keep"));
  assert.deepEqual(await run(fs, ["-RT", "--update=none", "from", "to"]), { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/to/existing")), "keep");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/to/missing")), "new");
});

test("cp --update=none skips the same file and dangling destination links", async () => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/link");
  for (const target of ["source", "link"]) {
    assert.deepEqual(await run(fs, ["--update=none", "source", target]), { exitCode: 0, stdout: "", stderr: "" });
  }
  assert.equal(await fs.readlink("/work/link"), "missing");
});

for (const option of ["--u", "--upd", "--pr"]) {
  test(`cp retains the optional argument for ${option}`, async () => {
    const fs = await fixture();
    assert.deepEqual(await run(fs, [option, "source", "target"]), { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(await fs.readFile("/work/target"), await fs.readFile("/work/source"));
  });
}

test("cp -p --no-preserve=mode copies the reported mode-600 source successfully", async () => {
  const fs = await fixture();
  await fs.chmod("/work/source", 0o600);
  assert.deepEqual(await run(fs, ["-p", "--no-preserve=mode", "source", "target"]), { exitCode: 0, stdout: "", stderr: "" });
  assert.deepEqual(await fs.readFile("/work/target"), await fs.readFile("/work/source"));
  assert.equal((await fs.stat("/work/target")).mtimeMs, 2000);
});

for (const [args, mode, timestamps] of [
  [["-p", "--no-preserve=mode"], 0o644, true],
  [["--no-preserve=mode", "-p"], 0o600, true],
  [["--preserve=mode,timestamps", "--no-preserve=mode,timestamps"], 0o644, false],
  [["-a", "--no-preserve=all"], 0o644, false],
  [["-p", "--no-preserve", "mode,timestamps"], 0o644, false],
  [["-p", "--no-preserve=context,xattr"], 0o600, true],
] as const) {
  test(`cp applies preservation options in order: ${args.join(" ")}`, async () => {
    const fs = await fixture();
    await fs.chmod("/work/source", 0o600);
    await fs.writeFile("/work/target", new TextEncoder().encode("y\n"));
    await fs.chmod("/work/target", 0o644);
    assert.deepEqual(await run(fs, [...args, "source", "target"]), { exitCode: 0, stdout: "", stderr: "" });
    const stat = await fs.stat("/work/target");
    assert.equal(stat.mode & 0o777, mode);
    assert.equal(stat.mtimeMs === 2000, timestamps);
  });
}

for (const option of ["--update=invalid", "--update=", "--no-preserve=invalid", "--no-preserve="]) {
  test(`cp rejects ${option} before modifying its destination`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/target", new TextEncoder().encode("keep"));
    const result = await run(fs, [option, "source", "target"]);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("invalid argument"), result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "keep");
  });
}
