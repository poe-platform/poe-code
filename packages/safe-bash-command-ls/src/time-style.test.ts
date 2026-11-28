import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createLsCommand } from "./index.js";

for (const [args, expected] of [
  [["-l", "--time-style=long-iso"], "2020-01-02 03:04"],
  [["-l", "--time-style=+%Y"], "2020"],
  [["-l", "--time-style=full-iso"], "2020-01-02 03:04:05.000000000 +0000"],
  [["--full-time"], "2020-01-02 03:04:05.000000000 +0000"],
  [["-l", "--time-style", "long-iso"], "2020-01-02 03:04"],
  [["-l", "--time-style=iso"], "2020-01-02 "],
  [["-l", "--time-style=locale"], "Jan  2  2020"],
  [["-l", "--time-style=full"], "2020-01-02 03:04:05.000000000 +0000"],
  [["--time-style=+%Y", "--full-time"], "2020-01-02 03:04:05.000000000 +0000"],
  [["--full-time", "--time-style=+%Y"], "2020"],
  [["-l", "--time-style=+old-%Y\nrecent-%H:%M"], "old-2020"],
  [["-l", "--time-style=+%F %T %% %s %z"], "2020-01-02 03:04:05 % 1577934245 +0000"],
  [["-l", "--time-style=+"], ""],
] as const) {
  test(`ls ${args.join(" ")} formats file timestamps`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new Uint8Array());
    const instant = Date.parse("2020-01-02T03:04:05Z");
    await fs.utimes("/a", instant, instant);
    let stdout = "", stderr = "";
    const context: CommandContext = {
      command: "ls", args: [...args, "a"], fs, cwd: "/", env: { TZ: "UTC" },
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    };
    const result = await createLsCommand().execute(context);
    assert.equal(stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(stdout, `-rw-rw-rw- 1 0 0 0 ${expected} a\n`);
  });
}

test("ls bounds custom timestamp widths before producing output", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array());
  for (const limits of [{ maxFormatWidth: 64 }, { maxOutputBytes: 64 }]) {
    let stdout = "", stderr = "";
    const result = await createLsCommand({ limits }).execute({
      command: "ls", args: ["-l", "--time-style=+%1000000000Y", "a"], fs, cwd: "/", env: {},
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.notEqual(result.exitCode, 0);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("format width limit exceeded"), stderr);
  }
});
