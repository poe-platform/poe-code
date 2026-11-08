import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { prCommands } from "../../../src/commands/pr/index.js";
import { nativeCases } from "./native-cases.js";

for (const fixture of nativeCases) {
  const profileRejection = fixture.name === "header-TZ-east-half-hour" || fixture.name === "header-UTF8-in-CUTF8";
  test(`pr independent ${profileRejection ? "explicit unsupported profile" : "native bytes"}: ${fixture.name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const [name, file] of Object.entries(fixture.files)) {
      await fs.writeFile(`/work/${name}`, Buffer.from(file.hex, "hex"));
      await fs.utimes(`/work/${name}`, file.mtimeMs, file.mtimeMs);
      assert.equal((await fs.stat(`/work/${name}`)).mtimeMs, file.mtimeMs);
    }
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC", ...fixture.env } })
      .use(prCommands({ clock: () => fixture.clockMs }));
    try {
      const words = fixture.args.map(value => `'${value.split("'").join("'\\''")}'`);
      const result = await shell.exec(`pr ${words.join(" ")}`, { stdin: Buffer.from(fixture.inputHex, "hex") });
      if (profileRejection) {
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdoutBytes.length, 0);
        assert.notEqual(result.stderr, "");
      } else {
        assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, {
          stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex, status: fixture.status,
        });
      }
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(fixture.files).sort());
      for (const [name, file] of Object.entries(fixture.files)) {
        assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex"), file.hex);
        assert.equal((await fs.stat(`/work/${name}`)).mtimeMs, file.mtimeMs);
      }
    } finally { await shell.dispose(); }
  });
}

test("pr current header samples its injected clock once across pages", async () => {
  const fixture = nativeCases.find(candidate => candidate.name === "header-current-stdin")!;
  let calls = 0;
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } })
    .use(prCommands({ clock: () => fixture.clockMs + calls++ * 86_400_000 }));
  try {
    const result = await shell.exec("pr -l11 -", { stdin: Buffer.from(fixture.inputHex, "hex") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
    assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});

test("pr named headers use each mtime without consulting the clock", async () => {
  const fixture = nativeCases.find(candidate => candidate.name === "sequential-header-mtimes")!;
  const fs = new MemoryFileSystem();
  for (const [name, file] of Object.entries(fixture.files)) {
    await fs.writeFile(`/${name}`, Buffer.from(file.hex, "hex"));
    await fs.utimes(`/${name}`, file.mtimeMs, file.mtimeMs);
  }
  const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } })
    .use(prCommands({ clock: () => { assert.fail("named file header must use its own mtime"); } }));
  try {
    const result = await shell.exec("pr -l11 left right");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
  } finally { await shell.dispose(); }
});

for (const [name, command, input, locale] of [
  ["omitted header", "pr -t input", "A\n", "C"],
  ["short page", "pr -l10 input", "A\n", "C"],
  ["empty named input", "pr input", "", "C"],
  ["empty standard input", "pr", "", "C"],
  ["omitted UTF-8 header", "pr -t -h 'é' input", "A\n", "C.UTF-8"],
  ["short UTF-8 header", "pr -l10 -h 'é' input", "A\n", "C.UTF-8"],
] as const) {
  test(`pr native no-header timezone independence: ${name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from(input));
    const shell = new Shell({ fs, env: { LC_ALL: locale, TZ: "EAST-5:30" } }).use(prCommands());
    try {
      const result = await shell.exec(command, { stdin: input });
      assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
        status: 0, stdoutHex: Buffer.from(input).toString("hex"), stderrHex: "",
      });
      assert.equal(Buffer.from(await fs.readFile("/input")).toString(), input);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
    } finally { await shell.dispose(); }
  });
}
