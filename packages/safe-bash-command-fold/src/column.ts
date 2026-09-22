import { FoldError, type FoldMode } from './contracts.js';
import { portableWidth } from './width.js';
export type FoldLocale = 'C' | 'UTF-8/Unicode-17.0.0';
export interface FoldColumnState { readonly column: number; readonly lastWidth: number }
export interface FoldGlyph { readonly codePoint: number; readonly byteLength: number }
/** Pure checked arithmetic; LF/file reset belongs to the engine, not this primitive. */
export function adjustFoldColumn(state: FoldColumnState, glyph: FoldGlyph, mode: FoldMode, locale: FoldLocale): FoldColumnState {
  if (locale !== 'C' && locale !== 'UTF-8/Unicode-17.0.0') throw new FoldError('LOCALE', 'Unavailable locale profile');
  if (!['columns', 'characters', 'bytes'].includes(mode)) throw new FoldError('OPTION', 'Unavailable counting mode');
  if (!Number.isSafeInteger(state.column) || state.column < 0 || !Number.isInteger(state.lastWidth) || state.lastWidth < 0 || state.lastWidth > 2 || !Number.isInteger(glyph.byteLength) || glyph.byteLength < 1 || glyph.byteLength > 4 || !Number.isInteger(glyph.codePoint) || glyph.codePoint < 0 || glyph.codePoint > 0x10ffff) throw new FoldError('ARITHMETIC', 'Invalid column or glyph admission');
  let { column, lastWidth } = state;
  const cp = glyph.codePoint;
  if (mode === 'bytes') column += glyph.byteLength;
  else if (cp === 8) {
    if (column > 0) {
      if (column < lastWidth) throw new FoldError('ARITHMETIC', 'Backspace subtraction underflow is not admitted');
      column -= lastWidth;
    }
  } else if (cp === 13) column = 0;
  else if (cp === 9) column += 8 - column % 8;
  else {
    const width = locale === 'C' ? cp === 0 ? 0 : cp < 128 ? portableWidth(cp) : -1 : portableWidth(cp);
    lastWidth = mode === 'characters' ? 1 : width < 0 ? 1 : width;
    column += lastWidth;
  }
  if (!Number.isSafeInteger(column)) throw new FoldError('ARITHMETIC', 'Column addition exceeds safe integer arithmetic');
  return { column, lastWidth };
}
