import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";

const str = (c: string) => ({t: "Str", c});
const plain = (c: string) => ({t: "Plain", c: [str(c)]});

it.each([
  ["<dl><dt>Term</dt><dd>Definition</dd></dl>", {t: "DefinitionList", c: [[[str("Term")], [[plain("Definition")]]]]}],
  ["<dl>\n<dt> First </dt><dd>One</dd><dd><p>Two</p><p>Three</p></dd><dt><em>Next</em></dt><dd><dl><dt>Inner</dt><dd>Meaning</dd></dl></dd></dl>",
    {t: "DefinitionList", c: [
      [[str("First")], [[plain("One")], [{t: "Para", c: [str("Two")]}, {t: "Para", c: [str("Three")]}]]],
      [[{t: "Emph", c: [str("Next")]}], [[{t: "DefinitionList", c: [[[str("Inner")], [[plain("Meaning")]]]]}]]]
    ]}],
  ["<dl><dt>A</dt><dt>B</dt><dd>Shared</dd></dl>", {t: "DefinitionList", c: [[[str("A"), {t: "LineBreak"}, str("B")], [[plain("Shared")]]]]}]
])("preserves HTML definition list structure through the command: %s", async (source, expected) => {
  let output = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(), args: ["-f", "html", "-t", "json"],
    stdin: (async function* () {yield new TextEncoder().encode(source);})(), signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(output).blocks).toEqual([expected]);
});

it("renders an HTML definition list as Markdown", async () => {
  let output = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(), args: ["-f", "html", "-t", "markdown"],
    stdin: (async function* () {yield new TextEncoder().encode("<dl><dt>Term</dt><dd>Definition</dd></dl>");})(), signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(output).toBe("Term\n: Definition\n");
});
