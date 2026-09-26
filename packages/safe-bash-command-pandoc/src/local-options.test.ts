import {expect, it, vi} from "vitest";
import {Volume} from "memfs";
import {createPandocCommand} from "./safe-bash.js";
import {convert} from "./engine.js";
const encode = (s: string) => new TextEncoder().encode(s);
async function run(args: string[], fixtures: Record<string, string> = {}) {
  const fs = Volume.fromJSON(fixtures);
  let stdout = "", stderr = "";
  const readFile = vi.fn(async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer));
  const result = await createPandocCommand().execute({args, readFile, stdin: [encode("Hello\n")], signal: new AbortController().signal,
    stdout: {write: async b => {stdout += new TextDecoder().decode(b);}}, stderr: {write: async b => {stderr += new TextDecoder().decode(b);}}});
  return {...result, stdout, stderr, readFile};
}
it.each(["--defaults=/settings.yaml", "-d"])("reads local YAML defaults %s and lets explicit flags override them", async flag => {
  const result = await run([flag, ...(flag === "-d" ? ["/settings.yaml"] : []), "-t", "plain"], {"/settings.yaml": "from: commonmark\nto: html\n"});
  expect(result).toMatchObject({exitCode: 0, stdout: "Hello\n", stderr: ""});
});
it("renders local body templates with assigned variables and repeated includes", async () => {
  const result = await run(["-f=commonmark", "-t=html", "--template=/page.html", "-Vname=Audit", "--variable-json=items:[1]", "-B", "/before", "-A", "/after", "-H", "/head"],
    {"/page.html": "$name$\n$header-includes$\n$for(items)$$items$$endfor$\n$body$", "/before": "<p>Before</p>\n", "/after": "<p>After</p>\n", "/head": "<meta name=\"audit\">"});
  expect(result).toMatchObject({exitCode: 0, stdout: 'Audit\n<meta name="audit">\n1\n<p>Before</p>\n<p>Hello</p>\n<p>After</p>\n', stderr: ""});
});
it.each(["--variable=audit=value", "-Vaudit=value", "--variable-json=audit:[1]", "--file-scope", "--sandbox"])("admits %s for ordinary local conversion", async option => {
  expect(await run(["-f=commonmark", "-t=html", option])).toMatchObject({exitCode: 0, stdout: "<p>Hello</p>\n", stderr: ""});
});
it("rejects unsafe defaults and recursive aliases without acquiring document input", async () => {
  for (const yaml of ["from: commonmark\nto: html\nfilter: executable\n", "from: commonmark\nto: html\nvariables: &x [*x]\n"]) {
    const result = await run(["-d", "/settings.yaml", "/input.md"], {"/settings.yaml": yaml});
    expect(result.exitCode).toBe(2);
    expect(result.readFile.mock.calls.map(c => c[0])).toEqual(["/settings.yaml"]);
    expect(result.stdout).toBe("");
  }
});
it("bounds SDK template reads and final output before publication", async () => {
  const publish = vi.fn(async () => {});
  await expect(convert([{bytes: encode("Hello")}], {from: "commonmark", to: "html", template: {bytes: encode("$body$")}}, {limits: {outputBytes: 3}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});
it("keeps option values and filenames literal while resolving defaults", async () => {
  const value = await run(["-f=commonmark", "-t=html", "-V", "--defaults"]);
  expect(value).toMatchObject({exitCode: 0, stdout: "<p>Hello</p>\n"});
  expect(value.readFile).not.toHaveBeenCalled();
  const literal = await run(["-f=commonmark", "-t=html", "--", "--defaults"], {"--defaults": "Literal"});
  expect(literal).toMatchObject({exitCode: 0, stdout: "<p>Literal</p>\n"});
});
it("reads ordered header/body includes without a custom template", async () => {
  const result = await run(["-f=commonmark", "-t=html", "-B", "/one", "--include-before-body=/two", "-A", "/after", "-H", "/head"], {"/one": "One\n", "/two": "Two\n", "/after": "After\n", "/head": "<meta name=\"audit\">\n"});
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('<meta name="audit">\n</head>');
  expect(result.stdout).toContain("<body>\nOne\nTwo\n<p>Hello</p>\nAfter\n</body>");
});
it("bounds and cancels local reads without publishing output", async () => {
  const publish = vi.fn(async () => {});
  const options = {from: "commonmark", to: "html", template: {bytes: encode("$body$")}};
  await expect(convert([{bytes: encode("Hello")}], options, {limits: {resourceBytes: 2}, output: {publish}})).rejects.toMatchObject({code: "E_LIMIT"});
  const controller = new AbortController();
  await expect(convert([{bytes: encode("Hello")}], {...options, template: {chunks: (async function* () {controller.abort(); yield encode("$body$");})()}}, {signal: controller.signal, output: {publish}})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(publish).not.toHaveBeenCalled();
});
it("file-scope parses operands separately instead of sharing link definitions", async () => {
  const inputs = [{bytes: encode("[link][ref]\n")}, {bytes: encode("[ref]: /target\n")}];
  const joined = await convert(inputs, {from: "commonmark", to: "html"}, {});
  const separate = await convert(inputs, {from: "commonmark", to: "html", fileScope: true}, {});
  expect(joined).toMatchObject({text: '<p><a href="/target">link</a></p>\n'});
  expect(separate).toMatchObject({text: '<p>[link][ref]</p>\n'});
});
it("supports nested conditional templates and refuses unsupported expressions", async () => {
  const options = {from: "commonmark", to: "html", variables: {show: true, name: "Audit"}};
  expect(await convert([{bytes: encode("Hello")}], {...options, template: {bytes: encode("$if(show)$$if(name)$$name$$else$Missing$endif$$else$Hidden$endif$\n$body$")}}, {})).toMatchObject({text: "Audit\n<p>Hello</p>\n"});
  await expect(convert([{bytes: encode("Hello")}], {...options, template: {bytes: encode("$partial()$")}}, {})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
it("deep merges metadata defaults across files", async () => {
  const result = await run(["-d", "/first.yaml", "-d", "/second.yaml", "-t=json"], {"/first.yaml": "from: commonmark\nto: html\nmetadata:\n  config:\n    a: first\n", "/second.yaml": "metadata:\n  config:\n    b: second\n"});
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).meta.config).toEqual({t: "MetaMap", c: {a: {t: "MetaString", c: "first"}, b: {t: "MetaString", c: "second"}}});
});
it.each(["-tplain", "-wplain", "--write=plain"])("explicit incoming format alias %s overrides YAML defaults", async flag => {
  expect(await run(["-d", "/settings.yaml", flag], {"/settings.yaml": "from: commonmark\nto: html\n"})).toMatchObject({exitCode: 0, stdout: "Hello\n"});
});
