import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";
import { parse, ParsedArguments } from "./options.js";

test("max-columns validates values and resets reused arguments", () => {
  for (const value of ["-1", "1.5", "NaN", "9007199254740992", ""]) {
    assert.throws(() => parse([`--max-columns=${value}`, "x"]), { message: "max-columns requires a nonnegative integer" });
  }
  assert.throws(() => parse(["x", "-M"]), { message: "-M requires a value" });
  const target = new ParsedArguments();
  assert.equal(parse(["-M3", "--max-columns=7", "x"], target).maxColumns, 7);
  assert.equal(parse(["x"], target).maxColumns, 0);
});

test("max-columns preserves file prefixes, match limits and JSON records", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/ci.log", Buffer.from("FAIL " + "x".repeat(300) + "\nFAIL short\nFAIL last\n"));
  const command = createRgCommand();
  for (const json of [false, true]) {
    const values = createCommandArguments(["-Hn", "-m", "2", "-M", "240", ...(json ? ["--json"] : []), "FAIL", "/ci.log"]);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(stderr, "");
    assert.equal(result.exitCode, 0);
    if (json) {
      const records = stdout.trim().split("\n").map(line => JSON.parse(line));
      const matches = records.filter(record => record.type === "match");
      assert.equal(matches.length, 2);
      assert.equal(matches[0].data.lines.text, "FAIL " + "x".repeat(300) + "\n");
    } else {
      assert.equal(stdout, "/ci.log:1:[Omitted long matching line]\n/ci.log:2:FAIL short\n");
    }
  }
});
