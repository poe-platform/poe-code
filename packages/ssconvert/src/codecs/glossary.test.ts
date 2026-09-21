import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { createRegistry } from "./registry.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 1000000, cells: 1000, sheets: 10, operations: 1000 } };
import type { Workbook } from "../workbook.js";

const source = '<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>Ignored</Name><Cells><Cell Row="0" Col="0" ValueType="60">Other</Cell></Cells></Sheet><Sheet><Name>Glossary</Name><Cells><Cell Row="0" Col="0" ValueType="60">Term</Cell><Cell Row="0" Col="2" ValueType="60">FR</Cell><Cell Row="1" Col="0" ValueType="60">café</Cell><Cell Row="1" Col="1" ValueType="60">first&#10;second</Cell><Cell Row="1" Col="2" ValueType="60">thé</Cell><Cell Row="2" Col="1" ValueType="60">continued</Cell></Cells><Rows><RowInfo No="1" Hidden="1" Unit="12"/></Rows></Sheet></Sheets></Workbook>';
const header = '# SOME DESCRIPTIVE TITLE.\n# Copyright (C) YEAR Free Software Foundation, Inc.\n# FIRST AUTHOR <EMAIL@ADDRESS>, YEAR.\n#\n#, fuzzy\nmsgid ""\nmsgstr ""\n"Project-Id-Version: Gnome Glossary\\n"\n"POT-Creation-Date: 2026-09-20 12:34UTC\\n"\n"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\\n"\n"Last-Translator: FULL NAME <EMAIL@ADDRESS>\\n"\n"Language-Team: LANGUAGE <fr@li.org>\\n"\n"MIME-Version: 1.0\\n"\n"Content-Type: text/plain; charset=CHARSET\\n"\n"Content-Transfer-Encoding: ENCODING\\n"\n';
it("constructs source-defined glossary entries using injected destination identity and clock", async () => {
  const volume = Volume.fromJSON({ "/input.gnumeric": source });
  const path = (uri: string) => uri.startsWith("file:") ? new URL(uri).pathname : uri;
  const engine = createEngine({ codecs: [], environment: context.environment, limits: context.limits, clock: { now: () => Date.UTC(2026, 8, 20, 12, 34) }, filesystem: {
    async read(uri) { return [new Uint8Array(volume.readFileSync(path(uri)) as Uint8Array)]; },
    async write(uri, bytes) { volume.writeFileSync(path(uri), bytes); }
  } });
  try {
    await engine.convert({ input: { kind: "resource", uri: "/input.gnumeric" }, destination: { kind: "resource", uri: "/fr.po" }, exportType: "Gnumeric_GnomeGlossary:po" }, { signal: context.signal });
    expect(volume.readFileSync("/fr.po", "utf8")).toBe(header + '\n#. first\n#. second\n#. continued\nmsgid "café"\nmsgstr "thé"\n');
    expect(volume.readFileSync("/input.gnumeric", "utf8")).toBe(source);
  } finally { await engine.dispose(); }
});
it("refuses missing glossary sheets rather than exporting generic tables", async () => {
  const book: Workbook = { sheets: [{ id: "s", name: "S", cells: [] }] };
  const writer = createRegistry([]).select("write", "Gnumeric_GnomeGlossary:po")!.write;
  expect(writer).toBeTypeOf("function");
  await expect(writer!(book, [], context)).rejects.toMatchObject({ message: "Could not find Gnome Glossary sheet" });
});
