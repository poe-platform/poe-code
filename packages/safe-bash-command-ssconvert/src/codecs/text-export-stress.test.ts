import { expect, it } from "vitest";
import { type CapabilityContext, type Workbook } from "../index.js";
import { writeConfigurableText, writePlainCsv } from "./text-export.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
  own() {}
};
const workbook = (value: string): Workbook => ({ sheets: [{ id: "a", name: "A", cells: [
  { row: 0, column: 0, value: { kind: "string", value } }
] }] });

it("admits the actual single-byte encoded output at the exact byte budget", async () => {
  const bytes = await writeConfigurableText(workbook("é"), ["charset=ISO-8859-1"],
    { ...context, limits: { ...context.limits, outputBytes: 2 } });
  expect(bytes).toEqual(new Uint8Array([233, 10]));
});

it.each(["automatic", "raw", "preserve"])("admits dense Latin-1 fields in %s mode at the exact final byte budget", async format => {
  expect(await writeConfigurableText(workbook("éé"), [`charset=ISO-8859-1 format=${format}`],
    { ...context, limits: { ...context.limits, outputBytes: 3 } }))
    .toEqual(new Uint8Array([233, 233, 10]));
});

it("rejects final byte expansion and failed-converter fallback beyond the budget", async () => {
  for (const charset of ["UTF-8", "UTF-16", "bogus"])
    await expect(writeConfigurableText(workbook("é"), [`charset=${charset}`],
      { ...context, limits: { ...context.limits, outputBytes: 2 } }))
      .rejects.toThrow("ssconvert output bytes limit exceeded");
});

it.each(["\u0085", "\u000b", "\u180e", "\ufeff"])("keeps measured GLib nonspace U+%s unquoted", async value => {
  for (const write of [writeConfigurableText, writePlainCsv])
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await write(workbook(value + "edge" + value), [], context)))
      .toBe(value + "edge" + value + "\n");
});

it.each(["\u00a0", "\u2028", "\u2029", "\u3000"])("quotes measured GLib separator %s", async value => {
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await writeConfigurableText(workbook(value + "edge"), [], context)))
    .toBe('"' + value + 'edge"\n');
});

it("doubles each matching Unicode scalar in a multichar quote", async () => {
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await writeConfigurableText(workbook("😀a🦊b"),
    ["quote='😀🦊' quoting-mode=always"], context))).toBe("😀🦊😀🦊😀a😀🦊🦊b😀🦊\n");
});

it("truncates text at native strlen NUL before trigger scanning", async () => {
  expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await writePlainCsv(workbook("safe\0,hidden"), [], context))).toBe("safe\n");
});
