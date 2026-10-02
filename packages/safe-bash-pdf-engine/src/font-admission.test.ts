import {expect, it, vi} from "vitest";
import {admitTrueTypeFont} from "./font-admission.js";
import {suppliedDefaultFont} from "./default-font.js";

const font = () => new Uint8Array(suppliedDefaultFont().bytes);
const fail = (message: string): never => {throw new Error(message);};
it("admits supplied sfnt metrics and coverage before any font parser runs", () => {
  const work = vi.fn();
  admitTrueTypeFont(font(), fail, work);
  expect(work.mock.calls.reduce((sum, [amount]) => sum + amount, 0)).toBeGreaterThan(1000);
});
it("refuses unsupported containers before parsing their directory", () => {
  const bytes = font(); new DataView(bytes.buffer).setUint32(0, 0x4f54544f);
  expect(() => admitTrueTypeFont(bytes, fail, () => {})).toThrow("Only sfnt TrueType glyf fonts");
});
it("refuses an overlapping table before any character-map expansion", () => {
  const bytes = font(), view = new DataView(bytes.buffer);
  view.setUint32(12 + 16 + 8, view.getUint32(12 + 8));
  expect(() => admitTrueTypeFont(bytes, fail, () => {})).toThrow("Invalid sfnt table range");
});
it("refuses a truncated font metric table before fontkit allocation", () => {
  const bytes = font(), view = new DataView(bytes.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    if (view.getUint32(record) === 0x68686561) view.setUint32(record + 12, 1);
  }
  expect(() => admitTrueTypeFont(bytes, fail, () => {})).toThrow("Missing/truncated font metric table");
});
it("propagates host work refusal during bounded coverage admission", () => {
  expect(() => admitTrueTypeFont(font(), fail, amount => {if (amount > 1) throw new Error("host budget exhausted");})).toThrow("host budget exhausted");
});
