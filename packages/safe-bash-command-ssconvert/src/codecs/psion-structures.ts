// Psiconv 0.9.9 parse_sheet.c variable and line lists; GPL-2.0-or-later.
import { SsconvertError } from "../contracts.js";

export interface PsionStructureCursor {
  u8(): number;
  u32(): number;
  x(): number;
  text(): string;
  float(): number;
}

/** Gnumeric ignores variable definitions, but psiconv still parses every value. */
export function parsePsionVariables(c: PsionStructureCursor): void {
  c.u8(); const number = c.x();
  for (let i = 0; i < number; i++) {
    c.text(); const type = c.u8();
    if (type === 0) c.u32();
    else if (type === 1) c.float();
    else if (type === 2) c.text();
    else if (type === 3 || type === 4) {
      c.u8(); for (let j = 0; j < (type === 3 ? 2 : 4); j++) c.u32();
    } else throw new SsconvertError("io", "Error while parsing Psion file.");
    c.u32();
  }
}

/** Rows precede columns; the first layout at a position wins in psiconv. */
export function parsePsionLineLayouts<T, C extends PsionStructureCursor>(c: C, inherited: T,
  readLayout: (c: C, inherited: T) => T): ReadonlyMap<number, T> {
  c.u8(); const number = c.x(), layouts = new Map<number, T>();
  for (let i = 0; i < number; i++) {
    const position = c.x(), layout = readLayout(c, inherited);
    if (!layouts.has(position)) layouts.set(position, layout);
  }
  return layouts;
}
