import {expect, it} from "vitest";
import {Volume} from "memfs";
import {convert, writeDocument} from "./engine.js";
import {createPandocCommand} from "./safe-bash.js";

it.each(["commonmark", "gfm"])("reports attributed publication content as unsupported in %s", async to => {
  await expect(writeDocument({blocks: [{t: "Div", c: [["chapter", ["epub-chapter"], []],
    [{t: "Para", c: [{t: "Str", c: "Matrix"}]}]]}], metadata: {}, resources: []}, {to}, {}))
    .rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", format: to, location: "$.blocks[0]"});
});

it("reports a nonrepresentable table with status 5 and keeps the memfs destination", async () => {
  const bytes = new TextEncoder().encode("Matrix");
  await expect(convert([{bytes}], {from: "csv", to: "commonmark"}, {})).rejects
    .toMatchObject({code: "E_UNSUPPORTED_FEATURE", format: "commonmark"});
  const volume = Volume.fromJSON({"/result": "Keep"});
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createPandocCommand().execute({args: ["-f", "csv", "-t", "commonmark", "-o", "/result"],
    stdin: [bytes], signal: new AbortController().signal,
    writeFile: async (path, output) => {volume.writeFileSync(path, output);},
    stdout: {write: async value => {stdout.push(value);}}, stderr: {write: async value => {stderr.push(value);}}});
  expect(result.exitCode).toBe(5);
  expect(stdout).toEqual([]);
  expect(new TextDecoder().decode(Buffer.concat(stderr)).startsWith("E_UNSUPPORTED_FEATURE:")).toBe(true);
  expect(volume.readFileSync("/result", "utf8")).toBe("Keep");
});
