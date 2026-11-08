import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import type { Sheet } from "../workbook.js";
import { writeClipboardGnumeric, writeGnumeric } from "./gnumeric.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
for (const route of ['workbook', 'clipboard'] as const) {
  const write = async (sheet: Sheet) => route === 'workbook' ? writeGnumeric({ sheets: [sheet] }, [], context) :
    writeClipboardGnumeric({ sheets: [sheet] }, sheet, { sheet: 's', startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 }, context);
  for (const field of ['defaultRowHeight', 'defaultColumnWidth'] as const) {
    it.each([0, -1, 'bad', Number.MAX_VALUE])(`${route} refuses unrepresentable ${field}: %s`, async value => {
      await expect(write({ id: 's', name: 'S', cells: [], view: { [field]: value } })).rejects.toMatchObject({ code: 'unsupported-feature' });
    });
  }
  for (const field of ['rows', 'columns'] as const) {
    it.each([0, Number.MAX_VALUE])(`${route} refuses unrepresentable explicit ${field}: %s`, async sizePoints => {
      await expect(write({ id: 's', name: 'S', cells: [], [field]: [{ index: 1, sizePoints }] })).rejects.toMatchObject({ code: 'unsupported-feature' });
    });
  }
}
it('clipboard validates only explicit axes in the copied range', () => {
  const sheet = { id: 's', name: 'S', cells: [], rows: [{ index: 3, sizePoints: 0 }] };
  expect(writeClipboardGnumeric({ sheets: [sheet] }, sheet, { sheet: 's', startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 }, context)).toBeInstanceOf(Uint8Array);
});
