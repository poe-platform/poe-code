import { expect, it, vi } from "vitest";
import { SsconvertError } from "../contracts.js";
import { Binary } from "./biff-binary.js";
import { parsePsionWord } from "./psion-word.js";
import type { PsionParseJob } from "./psion-page.js";
const dword = (n: number) => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24];
const text = (s: string) => [s.length * 4 + 2, ...Array.from(s, ch => ch.charCodeAt(0))];
function fixture(layout?: number[]): Uint8Array {
  const bytes = new Uint8Array(900);
  const entries = [[0x10000243, 100], [0x10000089, 120], [0x10000105, 180], [0x10000104, 280], [0x10000106, 500]];
  if (layout) entries.push([0x10000143, 600]);
  bytes.set([...dword(4), entries.length * 2, ...entries.flatMap(([id, offset]) => [...dword(id!), ...dword(offset!)])]);
  bytes.set([2, 0, 0, 1, 1, 8, ...dword(0), ...dword(100)], 100);
  bytes.set([...dword(0x1000007f), ...text("Word.app")], 120);
  bytes.set([...dword(0), ...dword(0), ...dword(0), 0, 0], 280);
  bytes.set([4, 65, 6], 500);
  if (layout) bytes.set(layout, 600);
  return bytes;
}
function factory(bytes: Uint8Array, tick: () => void = () => {}) {
  const b = new Binary(bytes);
  return (offset: number) => {
    let at = offset;
    return { get at() { return at; },
      u8() { tick(); return b.u8(at++); },
      u16() { tick(); const n = b.u16(at); at += 2; return n; },
      u32() { tick(); const n = b.u32(at); at += 4; return n; },
      characters(length: number) { tick(); const s = String.fromCharCode(...b.slice(at, length)); at += length; return s; },
      text() { tick(); const length = b.u8(at++) >> 2; const s = String.fromCharCode(...b.slice(at, length)); at += length; return s; },
      x() { tick(); return b.u8(at++) >> 1; } };
  };
}
function hooks() { return { page: vi.fn(function* () {}), embedded: vi.fn(function* () {}) }; }
function run(cursor: Parameters<typeof parsePsionWord>[0], h: Parameters<typeof parsePsionWord>[1]): void {
  const jobs: PsionParseJob[] = [parsePsionWord(cursor, h)];
  while (jobs.length) {
    const step = jobs[jobs.length - 1]!.next();
    if (step.done) jobs.pop(); else jobs.push(step.value);
  }
}
it("Psion Word requires and parses status, application, page, styles, and text", () => {
  const h = hooks(); run(factory(fixture()), h);
  expect(h.page).toHaveBeenCalledExactlyOnceWith(180);
  expect(h.embedded).not.toHaveBeenCalled();
});
it("Psion Word password sections are fatal even with zero offsets", () => {
  const bytes = fixture(); bytes[4] = 12;
  bytes.set([...dword(0x100000cd), ...dword(0)], 45);
  expect(() => run(factory(bytes), hooks())).toThrow("Error while parsing Psion file.");
});
it("Psion Word does not accept a missing required section", () => {
  const bytes = fixture(); bytes[4] = 8;
  expect(() => run(factory(bytes), hooks())).toThrow("Error while parsing Psion file.");
});
it("Psion Word parses styled normal paragraphs and inlines", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(1), ...dword(1), 0, ...dword(2), ...dword(2), 0x1e, 1];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word accepts anonymous layouts based on actual reverse-index named styles", () => {
  const bytes = fixture([1, 0, 1, ...dword(5), ...dword(0), 255, ...dword(0), ...dword(1), ...dword(2), 5, ...dword(0)]);
  bytes.set([...dword(0), ...dword(0), ...dword(0), 1, ...dword(0), 1, ...text("Heading"), ...dword(0x1000004f), ...dword(1), ...dword(2), 0x1e, 1, ...dword(0), 255], 280);
  expect(() => run(factory(bytes), hooks())).not.toThrow();
});
it("Psion Word anonymous base style lookup must exist", () => {
  const layout = [1, 0, 1, ...dword(5), ...dword(0), 255, ...dword(0), ...dword(0), ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).toThrow("Error while parsing Psion file.");
});
it("Psion Word direct paragraph missing base styles fall back to normal", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 255, ...dword(0), ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word inline embedded records parse markers, pointers, and complete dimensions", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(1), ...dword(1), 1, ...dword(2), ...dword(0), ...dword(0x10000051), ...dword(800), ...dword(200), ...dword(300)];
  const h = hooks(); run(factory(fixture(layout)), h);
  expect(h.embedded).toHaveBeenCalledExactlyOnceWith(800);
});
it("Psion Word corruption in character/paragraph layout payloads is fatal", () => {
  const bytes = fixture(); bytes.set(dword(1000), 280);
  expect(() => run(factory(bytes), hooks())).toThrow();
});
it("Psion Word shared cursor cancellation/budget failures propagate unchanged", () => {
  const reason = new SsconvertError("resource-limit", "shared budget exceeded");
  let work = 0;
  expect(() => run(factory(fixture(), () => { if (++work === 24) throw reason; }), hooks())).toThrow(reason);
});
it("Psion Word child page errors precede later corrupt style sections", () => {
  const bytes = fixture(); bytes.set(dword(1000), 280);
  const reason = new Error("child page rejected");
  const h = hooks(); h.page.mockImplementation(() => { throw reason; });
  expect(() => run(factory(bytes), h)).toThrow(reason);
});
it("Psion Word embedded child errors precede truncated object dimensions", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(1), ...dword(1), 1, ...dword(2), ...dword(0), ...dword(0x10000051), ...dword(800)];
  const bytes = fixture(layout).slice(0, 600 + layout.length);
  const reason = new Error("child object rejected");
  const h = hooks(); h.embedded.mockImplementation(() => { throw reason; });
  expect(() => run(factory(bytes), h)).toThrow(reason);
});
it("Psion Word explicitly qualifies native unsafe paragraph-count mismatches", () => {
  const layout = [1, 0, 0, ...dword(0), ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).toThrow("mismatched text/layout paragraph counts");
});
it("Psion Word explicitly qualifies native unsafe excess hotkey entries", () => {
  const bytes = fixture(); bytes.set([...dword(0), ...dword(0), ...dword(0), 1, ...dword(0), 0], 280);
  expect(() => run(factory(bytes), hooks())).toThrow("excess style hotkeys");
});
it("Psion Word named styles exceeding hotkey count get valid normal inheritance", () => {
  const bytes = fixture([1, 0, 1, ...dword(5), ...dword(0), 255, ...dword(0), ...dword(1), ...dword(2), 5, ...dword(0)]);
  bytes.set([...dword(0), ...dword(0), ...dword(0), 0, 1, ...text("Heading"), ...dword(123), ...dword(1), ...dword(0), ...dword(0), 0], 280);
  expect(() => run(factory(bytes), hooks())).not.toThrow();
});
it("Psion Word duplicate anonymous IDs use the first definition", () => {
  const layout = [1, 0, 2, ...dword(5), ...dword(0), 0, ...dword(0), ...dword(5), ...dword(0), 0, ...dword(0), ...dword(1), ...dword(2), 5, ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word unknown anonymous paragraph references use normal styles", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 5, ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word unknown layout type retains styled interpretation", () => {
  const layout = [99, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(0), ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word styleless layout omits base style bytes", () => {
  const layout = [0, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), ...dword(0), ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word excess inlines unassigned to paragraphs are not guessed or read", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(0), ...dword(0xffffffff)];
  expect(() => run(factory(fixture(layout).slice(0, 600 + layout.length)), hooks())).not.toThrow();
});
it("Psion Word unfulfilled inline counts do not perform unbudgeted billions of loops", () => {
  const layout = [1, 0, 0, ...dword(1), ...dword(2), 0, ...dword(0), 0, ...dword(0xffffffff), ...dword(0)];
  expect(() => run(factory(fixture(layout)), hooks())).not.toThrow();
});
it("Psion Word page and embedded child cancellation errors remain identical", () => {
  const reason = new DOMException("cancelled child", "AbortError"), h = hooks();
  h.page.mockImplementation(() => { throw reason; });
  expect(() => run(factory(fixture()), h)).toThrow(reason);
});
