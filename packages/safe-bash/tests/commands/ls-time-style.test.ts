import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

for (const [command, expected] of [
  ["ls -l --time-style=long-iso a | awk '{print $6,$7,$8}'", "2020-01-02 03:04 a\n"],
  ["ls -l --time-style=+%Y a | awk '{print $6,$7}'", "2020 a\n"],
  ["ls -l --time-style=full-iso a | awk '{print $6,$7,$8,$9}'", "2020-01-02 03:04:05.000000000 +0000 a\n"],
  ["ls --full-time a | awk '{print NF}'", "9\n"],
] as const) {
  test(`ls timestamp style works in shell pipelines: ${command}`, async context => {
    const shell = new Shell({ fs: await fixture(), cwd: "/work", env: { TZ: "UTC" } }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`touch -d '2020-01-02 03:04:05' a; ${command}`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  });
}

test("ls styles respect shell timezone, fractions and selected timestamps", async context => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work", env: { TZ: "UTC" } }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("touch -d '2020-01-02 03:04:05.125' a; touch -a -d '2021-02-03 04:05:06.25' a; TZ=Asia/Kolkata ls --full-time a | awk '{print $6,$7,$8}'; ls -lu --time-style=full-iso a | awk '{print $6,$7,$8}'");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "2020-01-02 08:34:05.125000000 +0530\n2021-02-03 04:05:06.250000000 +0000\n");
});

test("ls styles distinguish recent timestamps and preserve non-long listings", async context => {
  context.mock.method(Date, "now", () => Date.parse("2020-01-03T00:00:00Z"));
  const fs = await fixture({ a: "", "--full-time": "", "--time-style=long-iso": "" });
  const time = Date.parse("2020-01-02T03:04:05Z");
  await fs.utimes("/work/a", time, time);
  for (const [args, expected] of [
    [["-l", "--time-style=iso", "a"], "-rw-rw-rw- 1 0 0 0 01-02 03:04 a\n"],
    [["-l", "--time-style=+old\nrecent-%H:%M", "a"], "-rw-rw-rw- 1 0 0 0 recent-03:04 a\n"],
    [["--time-style=long-iso", "a"], "a\n"],
    [["--time-style=bad", "a"], "a\n"],
    [["--", "--full-time", "--time-style=long-iso"], "--full-time\n--time-style=long-iso\n"],
  ] as const) {
    const result = await run("ls", [...args], { fs });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  }
});

test("ls full-time lets later column formats disable long listings", async () => {
  const fs = await fixture({ a: "" });
  for (const layout of ["-C", "-x", "-m"]) {
    const result = await run("ls", ["--full-time", layout], { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "a\n");
  }
});

for (const args of [["--time-style"], ["-l", "--time-style="], ["-l", "--time-style=invalid"], ["-l", "--time-style=lo"], ["-l", "--time-style=+a\nb\nc"]]) {
  test(`ls rejects invalid time style ${args.join(" ")}`, async context => {
    const fs = await fixture();
    context.mock.method(fs, "lstat", async () => assert.fail("unexpected metadata access"));
    const result = await run("ls", args, { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  });
}
