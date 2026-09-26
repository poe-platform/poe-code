import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";
import { createLatexWriter } from "./latex.js";
import { writeRoff } from "./roff.js";
import { writeGlossary } from "./glossary.js";
import { latexFragmentHeader } from "./latex-syntax.js";

const context: CapabilityContext = {
  signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 1000, workbookWork: 1000000 }
};
function strings(values: readonly string[]): Workbook {
  return { sheets: [{ id: "s", name: "Controls", cells: values.map((value, row) => ({ row, column: 0, value: { kind: "string", value } })) }] };
}

it("retains nested raw TeX but escapes an unmatched raw delimiter and preserves control whitespace", async () => {
  // Native 1.12.61 measured with column Unit=1000 to exclude font-dependent overflow spans.
  const bytes = await createLatexWriter({ fragment: true })(strings(["\\l{a{b}%_} tail", "\\L{unterminated", "line\nnext\ttab", "−é😀"]), [], context);
  expect(Buffer.from(bytes).toString("latin1")).toBe(latexFragmentHeader + "a{b}%_ tail\\\\\n$\\backslash$L\\{unterminated\\\\\nline\nnext\ttab\\\\\n-é?\\\\\n");
});

it("uses roff me header and row macro ordering while escaping only dots and backslashes", async () => {
  // Complete expectation independently measured with the captured native C/UTC profile.
  const workbook: Workbook = { sheets: [{ id: "s", name: ".Sheet\\name", cells: [
    { row: 0, column: 0, value: { kind: "string", value: ".one\\two\nline\ttab é😀" } },
    { row: 1, column: 1, value: { kind: "error", value: "#DIV/0!" } }
  ] }] };
  expect(Buffer.from(await writeRoff(workbook, [], context)).toString()).toBe('.\\" TROFF file\n.fo \'\'%\'\'\n.Sheet\\name\n\n.TS H\nallbox;\nlp10 l.\n.vs 12.50p\n\\.one\\\\two\nline\ttab é😀\t \n.TH\n.T&\nl lp10.\n.vs 12.50p\n \t#DIV/0!\n.TE\n\n');
});

it("does not synthesize PO escaping and chooses the first Term sheet irrespective of active sheet", async () => {
  // Source-derived only: the captured native plugin profile cannot execute the Python glossary saver.
  const workbook = strings(["Term", 'a"\\b', "", "last"]);
  const first = workbook.sheets[0]!;
  const book: Workbook = { activeSheet: "other", sheets: [{ ...first, cells: [...first.cells,
    { row: 0, column: 2, value: { kind: "string", value: "FR" } },
    { row: 1, column: 1, value: { kind: "string", value: "first\nsecond" } },
    { row: 1, column: 2, value: { kind: "string", value: 'é"\\x' } },
    { row: 2, column: 1, value: { kind: "string", value: "continuation\tend" } }
  ] }, { id: "other", name: "Other", cells: strings(["Term", "ignored"]).sheets[0]!.cells }] };
  const text = Buffer.from(await writeGlossary(book, [], { ...context, outputFilename: "/nested/fr.po", clock: { now: () => 0 } })).toString();
  expect(text).toContain('"POT-Creation-Date: 1970-01-01 00:00UTC\\n"\n');
  expect(text.slice(text.indexOf('\n#. first'))).toBe('\n#. first\n#. second\n#. continuation\tend\nmsgid "a"\\b"\nmsgstr "é"\\x"\n\n#. \nmsgid "last"\nmsgstr ""\n');
  expect(text).not.toContain("ignored");
});

it("preserves cancellation reason when the injected glossary clock aborts", async () => {
  const controller = new AbortController(), reason = Object.freeze({ clockAbort: true });
  await expect(writeGlossary(strings(["Term", "word"]), [], { ...context, signal: controller.signal, clock: { now() { controller.abort(reason); return 0; } } })).rejects.toBe(reason);
});

it("reports invalid native exporter options before publishing or altering memfs paths", async () => {
  const volume = Volume.fromJSON({ "/input.gnumeric": '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>S</Name><Cells/></Sheet></Sheets></Workbook>', "/output.tex": "keep" });
  const before = volume.toJSON(), stderr: Uint8Array[] = [];
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits, filesystem: {
    async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
    async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); }
  } });
  try {
    const result = await runCommand(["-T", "Gnumeric_html:latex", "-O", "unknown=true", "/input.gnumeric", "/output.tex"], engine, { signal: context.signal, stdout: { async write() {} }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } } });
    expect(result.exitCode).toBe(1);
    expect(Buffer.concat(stderr).toString()).toContain("unknown");
    expect(volume.toJSON()).toEqual(before);
  } finally { await engine.dispose(); }
});
