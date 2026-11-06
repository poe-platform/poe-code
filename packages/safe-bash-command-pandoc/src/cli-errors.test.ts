import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";
import {parseConversionArgs} from "./cli.js";
import {convert} from "./engine.js";

const columns = "Argument of --columns must be a number greater than 0\n";
const wrap = "--wrap must be auto, none, or preserve\n";
const missing = (name: string, argument: string) => `option \`${name}' requires an argument ${argument}\nTry pandoc --help for more information.\n`;
const cases: [string[], string][] = [
  ...["0", "-1", "bad", "", "1.5", "1e2", "+2"].flatMap(value => [
    [[`--columns=${value}`], columns], [["--columns", value], columns]
  ] as [string[], string][]),
  ...["bad", "", "AUTO", "--columns"].flatMap(value => [
    [[`--wrap=${value}`], wrap], [["--wrap", value], wrap]
  ] as [string[], string][]),
  [["--columns"], missing("--columns", "NUMBER")],
  [["--wrap"], missing("--wrap", "auto|none|preserve")],
  [["--wrap=bad", "--columns"], missing("--columns", "NUMBER")],
  [["--columns=0", "--wrap"], missing("--wrap", "auto|none|preserve")],
  [["--columns=0", "--wrap=bad"], columns],
  [["--wrap=bad", "--columns=0"], wrap],
  [["--columns", "--wrap"], columns],
  [["--columns=8", "--columns=0"], columns]
];

it.each(cases)("matches native Pandoc errors for %j without publishing output", async (args, expected) => {
  for (const output of [[], ["-o", "/result"]]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/result", new TextEncoder().encode("existing output"));
    let stdout = "", stderr = "";
    const result = await createPandocCommand().execute({
      command: "pandoc", cwd: "/", env: {}, fs,
      args: ["-f", "gfm", "-t", "plain", ...output, ...args],
      stdin: (async function* () {yield new TextEncoder().encode("hello");})(),
      signal: new AbortController().signal,
      stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}},
      stderr: {async write(chunk) {stderr += new TextDecoder().decode(chunk);}}
    });
    expect({exitCode: result.exitCode, stdout, stderr}).toEqual({exitCode: 6, stdout: "", stderr: expected});
    expect(new TextDecoder().decode(await fs.readFile("/result"))).toBe("existing output");
  }
});

it("preserves structured SDK option errors", async () => {
  await expect(convert([{bytes: new TextEncoder().encode("hello")}], {from: "gfm", to: "plain", columns: 0}, {}))
    .rejects.toMatchObject({name: "PandocError", code: "E_OPTION", operation: "convert"});
});

it.each(["8", " 8 ", "0x8", "0o10"])("accepts native integer column syntax %j", value => {
  const parsed = parseConversionArgs(["--columns", value, "--wrap", "none"], {}, new AbortController().signal);
  expect(parsed.options).toMatchObject({columns: 8, wrap: "none"});
});
