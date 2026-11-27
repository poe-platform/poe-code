import assert from "node:assert/strict";
import test from "node:test";
import { type FsOptions } from "../../src/contracts/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

const times = {
  alpha: { mtimeMs: 180000, atimeMs: 60000, ctimeMs: 120000 },
  beta: { mtimeMs: 60000, atimeMs: 180000, ctimeMs: 60000 },
  gamma: { mtimeMs: 120000, atimeMs: 120000, ctimeMs: 180000 },
};

for (const [selector, expected] of [
  ["-c", "gamma\nalpha\nbeta\n"], ["-u", "beta\ngamma\nalpha\n"],
  ["--time=ctime", "gamma\nalpha\nbeta\n"], ["--time=status", "gamma\nalpha\nbeta\n"],
  ["--time=atime", "beta\ngamma\nalpha\n"], ["--time=access", "beta\ngamma\nalpha\n"],
  ["--time=use", "beta\ngamma\nalpha\n"], ["--time=mtime", "alpha\nbeta\ngamma\n"],
  ["--time=modification", "alpha\nbeta\ngamma\n"],
  ["-ct", "gamma\nalpha\nbeta\n"], ["-ut", "beta\ngamma\nalpha\n"],
] as const) {
  test(`ls ${selector} selects provider timestamps`, async context => {
    context.mock.method(Date, "now", () => 240000);
    const fs = await fixture({ alpha: "x", beta: "x", gamma: "x" });
    const lstat = fs.lstat.bind(fs);
    context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => ({
      ...await lstat(path, options), ...times[path.split("/").at(-1)! as keyof typeof times],
    }));
    const names = await run("ls", ["-1", selector], { fs });
    assert.equal(names.exitCode, 0);
    assert.equal(names.stderr, "");
    assert.equal(names.stdout, expected);
    const sorted = await run("ls", [selector, "-tr"], { fs });
    const order = selector.includes("mtime") || selector.includes("modification") ? "alpha\ngamma\nbeta\n" : expected;
    assert.equal(sorted.stdout, order.trimEnd().split("\n").reverse().join("\n") + "\n");
    const long = await run("ls", [selector, "-l"], { fs });
    const key = selector.startsWith("-c") || selector.includes("ctime") || selector.includes("status") ? "ctimeMs"
      : selector.includes("mtime") || selector.includes("modification") ? "mtimeMs" : "atimeMs";
    assert.equal(long.exitCode, 0);
    const entries = selector.endsWith("t") && selector.startsWith("-") && !selector.startsWith("--")
      ? expected.trimEnd().split("\n").map(name => [name, times[name as keyof typeof times]] as const)
      : Object.entries(times);
    assert.equal(long.stdout, "total 12\n" + entries.map(([name, metadata]) =>
      `-rw-rw-rw- 1 0 0 1 Jan  1 00:0${metadata[key] / 60000} ${name}\n`).join(""));
  });
}

test("ls long dates preserve GNU date fields in shell pipelines", async context => {
  context.mock.method(Date, "now", () => Date.parse("2026-01-02T03:04:05Z"));
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("touch -d '2020-01-02 03:04' a; ls -l a | cut -d' ' -f6-; ls -l a | awk '{print NF}'");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Jan  2  2020 a\n9\n");
  const filename = await shell.exec("ls -l a | awk '{print $9}'");
  assert.equal(filename.exitCode, 0);
  assert.equal(filename.stderr, "");
  assert.equal(filename.stdout, "a\n");
});

for (const [timestamp, expected] of [
  ["2026-01-02T03:04:05Z", "Jan  2 03:04"],
  ["2025-12-31T23:59:00Z", "Dec 31 23:59"],
  ["2020-01-02T03:04:00Z", "Jan  2  2020"],
  ["2026-01-02T03:04:06Z", "Jan  2  2026"],
  ["2025-07-03T12:09:29Z", "Jul  3  2025"],
  ["2025-07-03T12:09:30Z", "Jul  3 12:09"],
] as const) {
  test(`ls long date formats ${timestamp} as ${expected}`, async context => {
    context.mock.method(Date, "now", () => Date.parse("2026-01-02T03:04:05Z"));
    const fs = await fixture({ item: "" });
    const time = Date.parse(timestamp);
    await fs.utimes("/work/item", time, time);
    const result = await run("ls", ["-l", "item"], { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `-rw-rw-rw- 1 0 0 0 ${expected} item\n`);
  });
}

test("ls timestamp selectors obey order and stop at --", async () => {
  const fs = await fixture({ alpha: "x", beta: "x", "-u": "x" });
  await fs.utimes("/work/alpha", 100, 300);
  await fs.utimes("/work/beta", 300, 100);
  assert.equal((await run("ls", ["-cu", "--time", "mtime", "-t", "alpha", "beta"], { fs })).stdout, "alpha\nbeta\n");
  assert.equal((await run("ls", ["--", "-u"], { fs })).stdout, "-u\n");
});

for (const args of [["--time"], ["--time="], ["--time=invalid"]]) {
  test(`ls rejects invalid timestamp selection ${args.join(" ")}`, async context => {
    const fs = await fixture();
    context.mock.method(fs, "lstat", async () => assert.fail("unexpected metadata access"));
    const result = await run("ls", args, { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  });
}
