import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { cosArray, cosBool, cosDict, cosName, cosNumber, cosString, dictSet } from "../ast.js";

for (const mode of ["text", "choice", "checkbox", "name-state", "inherited", "widgets", "duplicate", "empty", "unknown"]) it(`streams ${mode} field details with buffered semantics`, async () => {
  const original = PdfDocument.create(); original.addPage();
  const field = cosDict({ T: cosString("fieldé"), FT: cosName(mode === "choice" ? "Ch" : mode === "checkbox" || mode === "name-state" || mode === "widgets" ? "Btn" : mode === "unknown" ? "Other" : "Tx"),
    V: mode === "choice" ? cosArray([cosString("first"), cosName("second"), cosNumber(4)]) : mode === "checkbox" || mode === "widgets" ? cosBool(true) : mode === "name-state" ? cosName("On") : cosString("value😀"), Ff: cosNumber(17), Q: cosNumber(2), MaxLen: cosNumber(20), TU: cosString("alt"), DV: cosName("default"),
    Opt: cosArray([cosString("one"), cosString("one"), cosArray([cosString("export"), cosString("display")]), cosString("")]) });
  if (mode === "widgets") dictSet(field, "Kids", cosArray([cosDict({ AP: cosDict({ N: cosDict({ Off: cosDict({}), Custom: cosDict({}) }) }) })]));
  const ref = original.cos.allocateObject(field);
  let root = ref;
  if (mode === "inherited") { const parent = original.cos.allocateObject(cosDict({ T: cosString("parent"), FT: cosName("Ch"), Ff: cosNumber(12), Q: cosNumber(1), MaxLen: cosNumber(90), V: cosString("parent value"), TU: cosString("parent alt"), DV: cosString("parent default"), Opt: cosArray([cosString("parent opt")]), Kids: cosArray([ref]) })); const child = original.cos.resolveDict(ref)!; child.entries.splice(0, child.entries.length, { key: cosName("T"), value: cosString("child") }, { key: cosName("Parent"), value: parent }); root = parent; }
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray(mode === "empty" ? [] : mode === "duplicate" ? [root, root] : [root]) }));
  const bytes = original.save(), expected = PdfDocument.load(bytes).getFormFields();
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in", bytes);
  const source = await PdfFileSource.open(fs, "/in"), doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" });
  try {
    let index = 0;
    for await (const field of doc.formFieldDetails()) {
      const baseline = expected[index++]!;
      expect(field).toMatchObject({ name: baseline.name, type: baseline.type, flags: baseline.flags, justification: baseline.justification });
      expect(field.altName).toBe(baseline.altName); expect(field.defaultValue).toBe(baseline.defaultValue); expect(field.maxLength).toBe(baseline.maxLength); expect(field.stateValue).toBe(baseline.stateValue);
      const options: string[] = [], values: string[] = [];
      for await (const value of field.options()) options.push(value);
      for await (const value of field.values()) values.push(value);
      expect(options).toEqual(baseline.options); expect(values).toEqual(baseline.stateValue !== undefined ? [baseline.stateValue] : baseline.selectedValues?.length ? baseline.selectedValues : [String(baseline.value)]);
    }
    expect(index).toBe(expected.length);
  } finally { await doc.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const release of ["advance", "return", "close", "abort"] as const) it(`releases borrowed field readers on ${release}`, async () => {
  const original = PdfDocument.create(); original.addPage();
  const field = original.cos.allocateObject(cosDict({ T: cosString("choice"), FT: cosName("Ch"),
    V: cosArray([cosString("a"), cosString("b")]),
    Opt: cosArray(Array.from({ length: 80 }, (_, i) => cosString(`option-${i}-long-name`))) }));
  dictSet(original.cos.resolveDict(original.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray([field, field]) }));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in", original.save());
  const signal = new AbortController();
  const source = await PdfFileSource.open(fs, "/in"), doc = await PdfRetainedDocument.open(source, { fs, directory: "/scratch" }, { signal: signal.signal });
  try {
    const fields = doc.formFieldDetails(), first = (await fields.next()).value!;
    const before = (await fs.readdir("/scratch")).length;
    const options = first.options(), values = first.values(), unopened = first.options();
    for (let i = 0; i < 40; i++) expect((await options.next()).value).toBe(`option-${i}-long-name`);
    expect((await fs.readdir("/scratch")).length).toBeGreaterThan(before);
    expect((await values.next()).value).toBe("a");
    if (release === "advance") await fields.next();
    else if (release === "return") await fields.return();
    else if (release === "close") await doc.close();
    else {
      signal.abort(new Error("cancel fields"));
      await expect(options.next()).rejects.toThrow("cancel fields");
      await fields.return();
    }
    expect((await options.next()).done).toBe(true);
    expect((await values.next()).done).toBe(true);
    await expect(unopened.next()).rejects.toThrow(release === "abort" ? "cancel fields" : release === "close" ? "document is closed" : "no longer active");
    await fields.return();
  } finally { await doc.close(); await source.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
