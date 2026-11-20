import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, readDocument, writeDocument} from "./engine.js";

const encode = (text: string) => new TextEncoder().encode(text);
const head = '<thead><tr><th>H1</th><th>H2</th></tr></thead>';
const fixtures = [
  ["row", head + '<tbody><tr><th>Label</th><td>Value</td></tr></tbody>'],
  ["section", head + '<tbody><tr><th>Section</th><th>Heading</th></tr><tr><td>First</td><td>Value</td></tr></tbody>'],
  ["nonprefix", head + '<tbody><tr><td>First</td><th scope="col">Label</th></tr></tbody>'],
  ["body-heading", '<tbody><tr><th>Section</th><th>Heading</th></tr><tr><td>First</td><td>Value</td></tr></tbody>'],
  ["already-strong", head + '<tbody><tr><th><strong>Label</strong></th><td>Value</td></tr></tbody>'],
  ["emphasized-row", head + '<tbody><tr><th><em>Label</em></th><td>Value</td></tr></tbody>']
] as const;

it.each(["gfm", "markdown", "rst"])("preserves HTML table header emphasis through buffered and retained %s", async to => {
  for (const [name, source] of fixtures) {
    const document = await readDocument({bytes: encode(`<table>${source}</table>`)}, {from: "html"}, {});
    const expected = await writeDocument(document, {to}, {});
    expect(expected.kind).toBe("text");
    if (expected.kind !== "text") throw new Error("Expected text");
    expect(expected.diagnostics).toEqual([]);
    if (to === "rst" && ["row", "already-strong", "emphasized-row"].includes(name)) expect(expected.text).toContain(":stub-columns: 1");
    else if (name === "section" || to === "rst" && name === "body-heading") expect(expected.text).toContain("**Section**");
    else if (name !== "body-heading") expect(expected.text).toContain(name === "emphasized-row" ? "**_Label_**" : "**Label**");
    expect(expected.text).not.toContain("****Label****");
    expect(expected.text).not.toContain("**Value**");
    const wire = await writeDocument(document, {to: "json"}, {});
    if (wire.kind !== "text") throw new Error("Expected JSON");
    const fs = new MemoryFileSystem(); let actual = "";
    const result = await convertToOutput([{chunks: [encode(wire.text)]}], {from: "json", to}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {write: async bytes => {actual += new TextDecoder().decode(bytes);}, close: async () => {}, abort: async () => {}}
    });
    expect(actual, name).toBe(expected.text);
    expect(result.diagnostics).toEqual([]);
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["gfm", "markdown", "rst"])("keeps unrelated strict table restrictions in %s", async to => {
  for (const body of [
    '<tbody><tr><th title="unsupported">Label</th><td>Value</td></tr></tbody>',
    '<tbody><tr><td role="unknown">First</td><td>Value</td></tr></tbody>',
    '<tbody><tr><th rowspan="2">Label</th><td>First</td></tr><tr><td>Second</td></tr></tbody>'
  ]) {
    const document = await readDocument({bytes: encode(`<table>${head}${body}</table>`)}, {from: "html"}, {});
    const wire = await writeDocument(document, {to: "json"}, {});
    if (wire.kind !== "text") throw new Error("Expected JSON");
    const input = {bytes: encode(wire.text)};
    await expect(convert([input], {from: "json", to}, {})).rejects.toMatchObject({code: to === "rst" ? "E_UNSUPPORTED_FEATURE" : "E_CAPABILITY"});
    const fs = new MemoryFileSystem(); let wrote = false;
    await expect(convertToOutput([input], {from: "json", to}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {write: async () => {wrote = true;}, close: async () => {}, abort: async () => {}}})).rejects.toMatchObject({code: to === "rst" ? "E_UNSUPPORTED_FEATURE" : "E_CAPABILITY"});
    expect(wrote).toBe(false); expect(await fs.readdir("/")).toEqual([]);
  }
});
