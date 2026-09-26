// Psiconv 0.9.9 parse_page.c/parse_texted.c/parse_common.c; GPL-2.0-or-later.
import type { Workbook } from "../workbook.js";
import { parsePsionWord } from "./psion-word.js";
import { SsconvertError } from "../contracts.js";
import { parsePsionCharacterLayout, parsePsionParagraphLayout, type PsionLayoutCursor } from "./psion-layout.js";
export interface PageCursor extends PsionLayoutCursor { u16(): number; x(): number; text(): string; }
export type CursorFactory = (offset: number) => PageCursor;
export type PsionParseJob = Generator<PsionParseJob, Workbook | void, unknown>;
type ParseJob = PsionParseJob;
type EmbeddedParser = (offset: number, cursor: CursorFactory) => ParseJob;
function unsupported(part: string): never { throw new SsconvertError("unsupported-feature", `ssconvert Psion ${part} is not qualified`); }
function invalid(): never { throw new SsconvertError("io", "Error while parsing Psion file."); }
function sectionTable(c: PageCursor): { id: number; offset: number }[] {
  const count = c.u8() >> 1, entries = [];
  for (let i = 0; i < count; i++) entries.push({ id: c.u32(), offset: c.u32() });
  return entries;
}
function* textLayout(c: PageCursor, cursor: CursorFactory, embedded: EmbeddedParser): ParseJob {
  const styled = c.u16() === 1;
  const types = c.u8();
  for (let i = 0; i < types; i++) {
    c.u32();
    if (styled) {
      const preview = cursor(c.at), length = preview.u32();
      // parse_styleless_layout_section constructs a normal-only style table.
      // Anonymous type lookup retries its same absent base; it cannot fall back.
      if (cursor(preview.at + length).u8() !== 0) throw new SsconvertError("io", "Error while parsing Psion file.");
    }
    parsePsionParagraphLayout(c); if (styled) c.u8();
    parsePsionCharacterLayout(c, undefined, false);
  }
  const paragraphs = c.u32(), inlineCounts: number[] = [];
  for (let i = 0; i < paragraphs; i++) {
    c.u32(); const reference = c.u8();
    if (reference) inlineCounts.push(0);
    else {
      if (styled) {
        const preview = cursor(c.at), length = preview.u32();
        cursor(preview.at + length).u8(); // Unknown paragraph base falls back to normal.
      }
      parsePsionParagraphLayout(c); if (styled) c.u8();
      inlineCounts.push(c.u32());
    }
  }
  const inlines = c.u32(); let consumed = 0;
  for (const count of inlineCounts) for (let i = 0; i < count && consumed < inlines; i++, consumed++) {
    const type = c.u8(); c.u32(); parsePsionCharacterLayout(c, undefined, false);
    if (type === 1) { c.u32(); yield embedded(c.u32(), cursor); c.u32(); c.u32(); }
  }
}
function* textEd(c: PageCursor, cursor: CursorFactory, embedded: EmbeddedParser): ParseJob {
  if (c.u32() !== 0x1000005c) throw new SsconvertError("io", "Error while parsing Psion file.");
  let layout = 0;
  for (;;) {
    const id = c.u32();
    if (id === 0x10000064) break;
    const offset = c.u32();
    if (id === 0x10000066) layout = offset;
  }
  const length = c.x(); c.characters(length);
  if (layout) yield textLayout(cursor(layout), cursor, embedded);
}
/** Gnumeric reads these structures through psiconv but does not import pages. */
export function* parsePsionPage(offset: number, cursor: CursorFactory, sheet?: (base: number) => PsionParseJob, sketch?: (cursor: CursorFactory) => void): PsionParseJob {
  // Resume parent byte reads only after each embedded body completes, matching
  // native depth-first diagnostics without consuming the host call stack.
  const bases = new WeakMap<CursorFactory, number>(); bases.set(cursor, 0);
  const embedded: EmbeddedParser = function* (objectOffset, outer) {
    const sections = new Map(sectionTable(outer(objectOffset)).map(e => [e.id, e.offset]));
    const icon = sections.get(0x1000012a), display = sections.get(0x10000146), base = sections.get(0x10000144);
    // Released psiconv tests icon presence before reading the display section.
    if (icon) {
      const d = outer(display ?? 0); d.u8(); d.u32(); d.u32(); d.u32();
      const i = outer(icon); i.text(); i.u32(); i.u32();
    }
    // Missing nested section table has an uninitialized-free native branch.
    if (!base) unsupported("embedded object without a nested section table");
    const absoluteBase = bases.get(outer)! + base;
    const nested: CursorFactory = at => {
      const target = cursor(absoluteBase + at);
      return new Proxy(target, { get(t, key) { return key === "at" ? t.at - absoluteBase : Reflect.get(t, key); } });
    };
    bases.set(nested, absoluteBase);
    const entries = sectionTable(nested(nested(0).u32()));
    const firstApp = entries.find(e => e.id === 0x10000089);
    if (!firstApp) invalid();
    const first = nested(firstApp.offset), type = first.u32(); first.text();
    if (type === 0x1000007f) {
      yield parsePsionWord(nested, { page: offset => page(offset, nested), embedded: offset => embedded(offset, nested) });
      return;
    }
    if (type === 0x10000088) {
      if (!sheet) unsupported("embedded Sheet objects");
      yield sheet(absoluteBase); return;
    }
    if (type === 0x1000007d) {
      if (!sketch) unsupported("embedded Sketch objects");
      sketch(nested); return;
    }
    if (type !== 0x10000085) return; // Native unknown-type branch ignores content.
    const table = new Map(entries.map(e => [e.id, e.offset]));
    const appOffset = table.get(0x10000089), pageOffset = table.get(0x10000105), textOffset = table.get(0x10000085);
    if (!appOffset || !pageOffset || !textOffset) invalid();
    const app = nested(appOffset);
    if (app.u32() !== 0x10000085 || app.text().toLowerCase() !== "texted.app") invalid();
    yield page(pageOffset, nested);
    yield textEd(nested(textOffset), nested, embedded);
  };
  function* page(pageOffset: number, pageCursor: CursorFactory): ParseJob {
    const c = pageCursor(pageOffset);
    for (let i = 0; i < 7; i++) c.u32();
    for (let i = 0; i < 2; i++) {
      const content = c.u8(); c.u8();
      for (let j = 0; j < 3; j++) c.u8();
      if (content) { parsePsionParagraphLayout(c); parsePsionCharacterLayout(c, undefined, false); yield textEd(c, pageCursor, embedded); }
      else c.u8(); // Released no-content header retains previous bool length.
    }
    c.u32(); c.u32(); c.u32(); c.u8();
  }
  yield page(offset, cursor);
}
