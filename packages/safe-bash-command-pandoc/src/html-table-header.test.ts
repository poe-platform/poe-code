import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createPandocCommand} from "./command.js";

async function convert(html: string, to = "json") {
  let stdout = "", stderr = "";
  const result = await createPandocCommand().execute({
    command: "pandoc", args: ["-f", "html", "-t", to],
    fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () {yield new TextEncoder().encode(html);})(),
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result).toEqual({exitCode: 0});
  expect(stderr).toBe("");
  return stdout;
}

it.each(["json", "markdown"])("reads a leading th row like an explicit table header in %s", async to => {
  const header = to === "json"
    ? '<tr id="heading"><th>A</th><th>B</th></tr>'
    : '<tr><th>A</th><th>B</th></tr>';
  const body = '<tr><td>x</td><td>y</td></tr>';
  expect(await convert(`<table>${header}${body}</table>`, to))
    .toBe(await convert(`<table><thead>${header}</thead><tbody>${body}</tbody></table>`, to));
});

it.each([
  ['<tr><th>A</th></tr><tr><td>x</td></tr>', 1, 1],
  ['<tr><th>A</th></tr><tr><th>B</th></tr><tr><td>x</td></tr>', 1, 2],
  ['<tr><td>A</td></tr><tr><th>x</th></tr>', 0, 2],
  ['<tr><th>A</th><td>B</td></tr><tr><td>x</td><td>y</td></tr>', 0, 2],
  ['<thead><tr><th>A</th></tr></thead><tbody><tr><th>x</th></tr></tbody>', 1, 1]
])("preserves header and body row boundaries: %s", async (rows, heads, bodies) => {
  const table = JSON.parse(await convert(`<table>${rows}</table>`)).blocks[0].c;
  expect(table[3][1]).toHaveLength(heads);
  expect(table[4][0][3]).toHaveLength(bodies);
});
