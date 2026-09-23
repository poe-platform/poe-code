import {expect, it, vi} from "vitest";
import {parseConversionArgs} from "./cli.js";
import {convert} from "./engine.js";
import {createPandocCommand} from "./safe-bash.js";
import type {Document, FilterCapability, FilterRequest} from "./types.js";

it.each(["--filter=identity.py", "-Fidentity.py", "--lua-filter=uppercase.lua", "-Luppercase.lua", "--citeproc", "-C"])("admits filter syntax: %s", arg => {
  expect(parseConversionArgs(["-fcommonmark", "-thtml", arg], {}, new AbortController().signal).options.filters).toHaveLength(1);
});

it("preserves mixed filter order and rejects missing paths", () => {
  expect(parseConversionArgs(["-fcommonmark", "-thtml", "-F", "a.py", "-C", "-L", "b.lua"], {}, new AbortController().signal).options.filters).toEqual([
    {kind: "json", path: "a.py"}, {kind: "citeproc"}, {kind: "lua", path: "b.lua"}
  ]);
  for (const arg of ["-F", "-L", "--filter=", "--lua-filter=", "--citeproc=yes"])
    expect(() => parseConversionArgs(["-fcommonmark", "-thtml", arg], {}, new AbortController().signal)).toThrow();
});

it("refuses unavailable processing before acquiring input", async () => {
  const read = vi.fn();
  const inputs = (async function* () {read(); yield new TextEncoder().encode("Hello");})();
  await expect(convert([{chunks: inputs}], {from: "commonmark", to: "html", filters: [{kind: "citeproc"}]}, {})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(read).not.toHaveBeenCalled();
});

it("keeps preflighted requests stable while input is acquired", async () => {
  const request = {kind: "json" as const, path: "allowed.py"};
  const requests: FilterRequest[] = [request];
  const apply = vi.fn(async (document: Document) => document);
  const supports = vi.fn((filter: FilterRequest) => filter.kind === "json" && filter.path === "allowed.py");
  const chunks = (async function* () {
    request.path = "denied.py";
    requests.push({kind: "citeproc"});
    yield new TextEncoder().encode("Hello");
  })();
  await convert([{chunks}], {from: "commonmark", to: "html", filters: requests}, {filters: {supports, apply}});
  expect(supports).toHaveBeenCalledExactlyOnceWith({kind: "json", path: "allowed.py"});
  expect(apply).toHaveBeenCalledOnce();
  expect(apply.mock.calls[0]).toEqual([expect.anything(), {kind: "json", path: "allowed.py"}, expect.anything()]);
});

it.each([{}, {apply: true}, {apply: async (document: Document) => document, supports: true}])("rejects malformed filter authority before input acquisition", async filters => {
  const acquire = vi.fn();
  const chunks = (async function* () {acquire(); yield new TextEncoder().encode("Hello");})();
  await expect(convert([{chunks}], {from: "commonmark", to: "html", filters: [{kind: "citeproc"}]}, {filters: filters as FilterCapability})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(acquire).not.toHaveBeenCalled();
});

it("runs injected processing through the shell adapter before writing", async () => {
  const apply = vi.fn(async (document: Document, request: FilterRequest): Promise<Document> => ({...document, blocks: [{t: "Para", c: [{t: "Str", c: request.kind === "lua" ? "HELLO" : "Hello"}]}]}));
  let stdout = "";
  const result = await createPandocCommand({filters: {apply}}).execute({
    args: ["-fcommonmark", "-thtml", "-F", "identity.py", "-Luppercase.lua", "-C"],
    signal: new AbortController().signal, stdin: [new TextEncoder().encode("Hello")],
    stdout: {write: async bytes => {stdout += new TextDecoder().decode(bytes);}}, stderr: {write: async () => {}}
  });
  expect(result.exitCode).toBe(0);
  expect(apply.mock.calls.map(call => call[1].kind)).toEqual(["json", "lua", "citeproc"]);
  expect(apply.mock.calls[2]?.[0].blocks).toEqual([{t: "Para", c: [{t: "Str", c: "HELLO"}]}]);
  expect(stdout).toBe("<p>Hello</p>\n");
});

it("supplies merged metadata and target format to processing", async () => {
  const apply = vi.fn(async (document: Document) => document);
  await convert([{bytes: new TextEncoder().encode("Hello")}], {from: "commonmark", to: "html", metadataJson: [{title: "Audit"}], filters: [{kind: "citeproc"}]}, {filters: {apply}});
  expect(apply.mock.calls[0]?.[0].metadata.title).toEqual({t: "MetaString", c: "Audit"});
});

it("validates processed documents and prevents publication on failures", async () => {
  const publish = vi.fn();
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], {from: "commonmark", to: "html", filters: [{kind: "lua", path: "bad.lua"}]}, {
    filters: {apply: async () => ({blocks: [{t: "Unknown"}], metadata: {}, resources: []}) as unknown as Document}, output: {publish}
  })).rejects.toMatchObject({code: "E_AST"});
  expect(publish).not.toHaveBeenCalled();
});

it("cancels a pending processor without publishing", async () => {
  const controller = new AbortController();
  const publish = vi.fn();
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], {from: "commonmark", to: "html", filters: [{kind: "citeproc"}]}, {
    signal: controller.signal, filters: {apply: async () => {controller.abort(); return new Promise(() => {});}}, output: {publish}
  })).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(publish).not.toHaveBeenCalled();
});
