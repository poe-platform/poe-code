import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { prCommands } from "../../../src/commands/pr/index.js";
import { extraCases } from "./extra-fixtures.js";

for (const [args, date, title] of [
  ["--date-format=AUDITDATE a", "AUDITDATE", "a"],
  ["--date-format AUDITDATE a", "AUDITDATE", "a"],
  ["--date-format='%Y/%m/%d %H:%M %%' a", "2000/01/01 00:00 %", "a"],
  ["--date-format='' a", "", "a"],
  ["--date-format='%F'", "2001-01-01", ""],
  ["-m --date-format='%F' a b", "2001-01-01", ""],
] as const) test(`custom header date: ${args}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const name of ["a", "b"]) {
    await fs.writeFile(`/work/${name}`, Buffer.from("alpha\nbeta\n"));
    await fs.utimes(`/work/${name}`, 946684800000, 946684800000);
  }
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC", POSIXLY_CORRECT: "1" } })
    .use(prCommands({ clock: () => 978307200000 }));
  try {
    const result = await shell.exec(`pr ${args}`, { stdin: Buffer.from("alpha\nbeta\n") });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const padding = Math.max(0, 72 - date.length - title.length - "Page 1".length);
    assert.equal(result.stdout.split("\n")[2], `${date}${" ".repeat(Math.floor(padding / 2))}${title}${" ".repeat(Math.ceil(padding / 2))}Page 1`);
  } finally { await shell.dispose(); }
});

test("custom header date requires an argument", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands());
  try {
    const result = await shell.exec("pr --date-format");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "pr: option '--date-format' requires an argument\nTry 'pr --help' for more information.\n");
  } finally { await shell.dispose(); }
});

for (const fixture of extraCases) test(`extra native: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/directory", { recursive: true });
  for (const [name, text] of Object.entries({ a: "a\nb\nc\nd\n", b: "B\n", empty: "" })) {
    await fs.writeFile(`/work/${name}`, Buffer.from(text));
    await fs.utimes(`/work/${name}`, 946684800000, 946684800000);
  }
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands({ clock: () => 946684800000 }));
  try {
    const result = await shell.exec(`pr ${fixture.args.map(value => `'${value.split("'").join("'\\''")}'`).join(" ")}`, { stdin: Buffer.from(fixture.inputHex, "hex") });
    assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, {
      stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex, status: fixture.status,
    });
  } finally { await shell.dispose(); }
});
