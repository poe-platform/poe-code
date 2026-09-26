import {describe, expect, it, vi} from "vitest";
import {Volume} from "memfs";
import {convert, writeDocument} from "./engine.js";
import {createPandocCommand} from "./safe-bash.js";
import {resolveConversionArgs} from "./defaults.js";

const encode = (text: string) => new TextEncoder().encode(text);
const input = (text: string) => ({bytes: encode(text)});
const signal = new AbortController().signal;

async function command(args: string[], extra: Record<string, string> = {}, limits = {}) {
  const volume = Volume.fromJSON({
    "sample.md": "Hello\n", "settings.yaml": "from: commonmark\nto: html\n",
    "minimal.html": "$body$\n", "header.html": '<meta name="audit" content="yes">\n',
    "before.html": "<p>Before</p>\n", "after.html": "<p>After</p>\n", "out": "Keep", ...extra
  }, "/");
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createPandocCommand({limits}).execute({
    args, signal, stdin: [], cwd: "/",
    readFile: async path => new Uint8Array(volume.readFileSync(`/${path}`) as Buffer),
    writeFile: async (path, bytes) => {volume.writeFileSync(`/${path}`, bytes);},
    stdout: {write: async bytes => {stdout.push(bytes);}}, stderr: {write: async bytes => {stderr.push(bytes);}}
  });
  return {...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), volume};
}

describe("explicit local Pandoc options", () => {
  it.each(["--defaults=settings.yaml", "-dsettings.yaml"])("loads YAML defaults: %s", async flag => {
    expect(await command([flag, "sample.md"])).toMatchObject({exitCode: 0, stdout: "<p>Hello</p>\n", stderr: ""});
  });
  it.each([
    ["--template=minimal.html"], ["--variable=audit=value"], ["-V", "audit=value"],
    ["--variable-json=audit:[1]"], ["--file-scope"], ["--sandbox"]
  ])("accepts the reported conversion option %s", async (...flags) => {
    expect(await command(["-fcommonmark", "-thtml", ...flags, "sample.md"])).toMatchObject({exitCode: 0, stdout: "<p>Hello</p>\n", stderr: ""});
  });
  it.each([
    ["--include-in-header=header.html", '<meta name="audit" content="yes">'], ["-Hheader.html", '<meta name="audit" content="yes">'],
    ["--include-before-body=before.html", "<p>Before</p>"], ["-Bbefore.html", "<p>Before</p>"],
    ["--include-after-body=after.html", "<p>After</p>"], ["-Aafter.html", "<p>After</p>"]
  ])("renders explicit HTML includes and implies standalone: %s", async (flag, included) => {
    const result = await command(["-fcommonmark", "-thtml", flag, "sample.md"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("<!DOCTYPE html>");
    expect(result.stdout).toContain(included);
    expect(result.stdout).toContain("<p>Hello</p>");
  });
  it("renders SDK templates, variables and includes through the same writer", async () => {
    const result = await convert([input("Hello")], {
      from: "commonmark", to: "html", template: input("$header-includes$$body$$audit$ $$"),
      variables: {audit: [1, 2]}, includeInHeader: [input("HEAD\n")],
      includeBeforeBody: [input("BEFORE\n")], includeAfterBody: [input("AFTER\n")]
    }, {});
    expect(result).toMatchObject({kind: "text", text: "HEAD\nBEFORE\n<p>Hello</p>\nAFTER\n12 $"});
    expect(await writeDocument({blocks: [], metadata: {}, resources: []}, {to: "html", template: input("$audit$"), variables: {audit: "value"}}, {})).toMatchObject({text: "value"});
  });
  it("merges repeated defaults and lets explicit options override defaults regardless of order", async () => {
    const result = await command(["-tplain", "-d", "settings.yaml", "-d", "other.yaml", "sample.md"], {"other.yaml": "from: commonmark\nvariables:\n  audit: true\n"});
    expect(result).toMatchObject({exitCode: 0, stdout: "Hello\n", stderr: ""});
  });
  it("isolates references with file-scope instead of joining input documents", async () => {
    const inputs = [input("[link][ref]\n"), input("[ref]: /target\n")];
    expect(await convert(inputs, {from: "commonmark", to: "html"}, {})).toMatchObject({text: '<p><a href="/target">link</a></p>\n'});
    expect(await convert(inputs, {from: "commonmark", to: "html", fileScope: true}, {})).toMatchObject({text: "<p>[link][ref]</p>\n"});
  });
  it.each([
    {extra: {"settings.yaml": "from: commonmark\nto: html\nunknown: true\n"}, code: "E_OPTION"},
    {extra: {"settings.yaml": "from: [unterminated\n"}, code: "E_OPTION"},
    {extra: {"settings.yaml": "from: commonmark\nto: html\nvariables: &x [*x]\n"}, code: "E_OPTION"}
  ])("rejects invalid defaults without publishing output: $code", async ({extra, code}) => {
    const result = await command(["-dsettings.yaml", "sample.md", "-oout"], extra);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(code);
    expect(result.volume.readFileSync("/out", "utf8")).toBe("Keep");
  });
  it("shares the input ceiling across defaults and conversion inputs", async () => {
    const result = await command(["-d", "settings.yaml", "sample.md", "-oout"], {}, {inputBytes: 28});
    expect(result).toMatchObject({exitCode: 7, stdout: ""});
    expect(result.volume.readFileSync("/out", "utf8")).toBe("Keep");
  });
  it("shares input and output budgets with templates and includes", async () => {
    await expect(convert([input("Hello")], {from: "commonmark", to: "html", template: input("$body$\n")}, {limits: {inputBytes: 10}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(convert([input("Hello")], {from: "commonmark", to: "html", template: input("$audit$$audit$"), variables: {audit: "12345678"}}, {limits: {outputBytes: 15}})).rejects.toMatchObject({code: "E_LIMIT"});
  });
  it("rejects unsupported template syntax and formats before output publication", async () => {
    const publish = async () => {throw new Error("published invalid output");};
    await expect(convert([input("Hello")], {from: "commonmark", to: "html", template: input("$partial()$")}, {output: {publish}})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
    await expect(convert([input("Hello")], {from: "commonmark", to: "pdf", template: input("$body$")}, {output: {publish}})).rejects.toMatchObject({code: "E_OPTION"});
  });
  it("rejects unsupported template loop separators before publication", async () => {
    const publish = vi.fn(async () => {});
    await expect(convert([input("Hello")], {
      from: "commonmark", to: "html", template: input("$for(audit)$$audit$$sep$,$endfor$"), variables: {audit: [1, 2]}
    }, {output: {publish}})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
    expect(publish).not.toHaveBeenCalled();
  });
  it("exposes async defaults parsing without ambient file access", async () => {
    const parsed = await resolveConversionArgs(["-dsettings.yaml"], {readFile: async () => encode("from: commonmark\nto: html\n")}, signal);
    expect(parsed.options).toMatchObject({from: "commonmark", to: "html"});
    await expect(resolveConversionArgs(["-dsettings.yaml"], {}, signal)).rejects.toMatchObject({code: "E_OPTION"});
  });
  it("leaves a supplied conversion output open while parsing defaults", async () => {
    const abort = vi.fn(async () => {});
    await resolveConversionArgs(["-d", "settings.yaml"], {readFile: async () => encode("from: commonmark\nto: html\n")}, signal, {
      output: {write: async () => {}, close: async () => {}, abort}
    });
    expect(abort).not.toHaveBeenCalled();
  });
  it("accepts stdin in defaults and preserves CLI operand precedence", async () => {
    const stdin = [encode("From stdin")];
    const files = {stdin, readFile: async () => encode('from: commonmark\nto: html\ninput-files: ["-"]\n')};
    const parsed = await resolveConversionArgs(["-d", "settings.yaml"], files, signal);
    expect(parsed.operands).toEqual([{source: "stdin", chunks: stdin}]);
    const explicit = await resolveConversionArgs(["-d", "settings.yaml", "sample.md"], files, signal);
    expect(explicit.operands?.map(source => source.source)).toEqual(["sample.md"]);
  });
});
