import { findMatches, type Pattern } from './match.js';
import type { CodeTree } from './tree.js';

export interface Edit { range: [number, number]; replacement: string }
/** Apply nonoverlapping edits to the original UTF-8 byte positions, atomically. */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  const bytes = new TextEncoder().encode(source);
  const sorted = [...edits].sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  let end = 0;
  for (const edit of sorted) {
    const [from, to] = edit.range;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < end || to < from || to > bytes.length) {
      throw new Error('Invalid or overlapping edit range');
    }
    if ((from < bytes.length && (bytes[from]! & 0xc0) === 0x80) ||
        (to < bytes.length && (bytes[to]! & 0xc0) === 0x80)) throw new Error('Edit splits a UTF-8 character');
    parts.push(decoder.decode(bytes.slice(end, from)), edit.replacement);
    end = to;
  }
  parts.push(decoder.decode(bytes.slice(end)));
  return parts.join('');
}
/** Rewrite outermost matches once. Captured source is inserted verbatim. */
export function rewriteCode(tree: CodeTree, pattern: Pattern, template: string): string {
  const edits: Edit[] = [];
  let end = -1;
  for (const match of findMatches(tree, pattern)) {
    if (match.node.range[0] < end) continue;
    const replacement = template.replace(/\$\$\$[A-Z_][A-Z_0-9]*|\$[A-Z_][A-Z_0-9]*/g, token => {
      const name = token.startsWith('$$$') ? token.slice(3) : token.slice(1);
      const capture = match.captures[name];
      if (!capture) throw new Error(`Unknown rewrite capture: ${token}`);
      return capture.text;
    });
    edits.push({ range: match.node.range, replacement });
    end = match.node.range[1];
  }
  return applyEdits(tree.source, edits);
}
