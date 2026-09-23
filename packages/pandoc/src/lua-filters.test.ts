import {expect, it, vi} from "vitest";
import {Volume} from "memfs";
import {convert} from "./engine.js";
import {createExecutionContext} from "./execution.js";
import type {Document} from "./types.js";
import type {Inline} from "./ast-types.js";
import {createPandocCommand} from "./safe-bash.js";
import {createLuaFilterCapability} from "./lua-filters.js";

const encoder = new TextEncoder();
function setup(source: string) {
  const fs = Volume.fromJSON({"/uppercase.lua": source});
  return createLuaFilterCapability({readFile: async path => new Uint8Array(fs.readFileSync(path) as Buffer)});
}
const options = {from: "commonmark", to: "html", filters: [{kind: "lua" as const, path: "/uppercase.lua"}]};

it("executes the reported genuine Lua Str callback", async () => {
  const filters = setup("function Str(el) el.text = string.upper(el.text); return el end");
  await expect(convert([{bytes: encoder.encode("Hello *world*")}], options, {filters})).resolves.toMatchObject({text: "<p>HELLO <em>WORLD</em></p>\n"});
});

it("runs Lua control flow and closures rather than recognizing filter source", async () => {
  const filters = setup('local count = 0; function Str(el) count = count + 1; if count == 2 then el.text = el.text .. "!" end; return el end');
  await expect(convert([{bytes: encoder.encode("Hello world")}], options, {filters})).resolves.toMatchObject({text: "<p>Hello world!</p>\n"});
});

it.each(["function Str(el) error('broken') end", "function Str(el) return 42 end", "function Para(el) return el end", "function Str("])("rejects invalid or unsupported Lua without publication: %s", async source => {
  const publish = vi.fn();
  await expect(convert([{bytes: encoder.encode("Hello")}], options, {filters: setup(source), output: {publish}})).rejects.toMatchObject({name: "PandocError"});
  expect(publish).not.toHaveBeenCalled();
});

it("terminates a Lua loop using the conversion work budget", async () => {
  await expect(convert([{bytes: encoder.encode("Hello")}], options, {limits: {work: 10000}, filters: setup("while true do end")})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("does not expose ambient filesystem or process libraries", async () => {
  const filters = setup('assert(io == nil and os == nil and package == nil and debug == nil and dofile == nil and loadfile == nil); function Str(el) return nil end');
  await expect(convert([{bytes: encoder.encode("Hello")}], options, {filters})).resolves.toMatchObject({text: "<p>Hello</p>\n"});
});


it.each([{flags: ["-L", "/uppercase.lua"]}, {flags: ["--lua-filter=/uppercase.lua"]}])("executes local Lua through command flags $flags", async ({flags}) => {
  let stdout = "";
  let stderr = "";
  const result = await createPandocCommand({filters: setup("function Str(el) el.text = string.upper(el.text); return el end")}).execute({
    args: ["-f", "commonmark", "-t", "html", ...flags],
    stdin: [encoder.encode("Hello")], signal: new AbortController().signal,
    stdout: {write: async bytes => {stdout += new TextDecoder().decode(bytes);}},
    stderr: {write: async bytes => {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result).toEqual({exitCode: 0});
  expect(stdout).toBe("<p>HELLO</p>\n");
  expect(stderr).toBe("");
});

it("rejects mixed unsupported filters before reading local Lua", async () => {
  const readFile = vi.fn();
  const filters = createLuaFilterCapability({readFile});
  await expect(convert([{bytes: encoder.encode("Hello")}], {
    ...options, filters: [...options.filters, {kind: "citeproc"}]
  }, {filters})).rejects.toMatchObject({code: "E_CAPABILITY"});
  expect(readFile).not.toHaveBeenCalled();
});


it("preserves image origins and SDK sidecars while transforming captions", async () => {
  const target = ["image.png", ""] as const;
  const image: Inline = {t: "Image", c: [["", [], []], [{t: "Str", c: "Caption"}], target]};
  const document: Document = {blocks: [{t: "Para", c: [image]}], metadata: {}, resources: [{id: "/image.png", bytes: Uint8Array.of(1)}], language: "en", direction: "rtl"};
  const filters = setup("function Str(el) el.text = string.upper(el.text); return el end");
  const result = await filters.apply(document, {kind: "lua", path: "/uppercase.lua"}, Object.assign(createExecutionContext("convert"), {to: "html"}));
  const transformed = (result.blocks[0] as {c: readonly Inline[]}).c[0] as Extract<Inline, {t: "Image" | "Link"}>;
  expect(transformed.c[1]).toEqual([{t: "Str", c: "CAPTION"}]);
  expect(transformed.c[2]).toBe(target);
  expect(result.resources).toBe(document.resources);
  expect(result.language).toBe("en");
  expect(result.direction).toBe("rtl");
  expect(image.c[1]).toEqual([{t: "Str", c: "Caption"}]);
});
