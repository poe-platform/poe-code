import { byteText } from './bytes.js';
import type { ImageMagickDiscovery } from './imagemagick.js';
import type { AccessReference } from './resolution-types.js';

/** Shared resource positions for argv and already observed script tokens. */
export function imageMagickAccessReferences(discovery: ImageMagickDiscovery): { references: AccessReference[]; inline: Map<AccessReference, Uint8Array> } {
  const references: AccessReference[] = [];
  const inline = new Map<AccessReference, Uint8Array>();
  for (const r of discovery.resources) {
    const token = discovery.tokens.find(t => t.source === r.source && t.index === r.index);
    const indirectText = r.role === 'text' && token?.values.find(value => {
      const text = byteText(value);
      let offset = 0;
      while (' \t\r\n\f\v'.includes(text[offset] ?? '\0')) offset++;
      return text[offset] === '@' && text.slice(offset + 1) === byteText(r.operand);
    });
    const value = indirectText || r.operand;
    let kind: AccessReference['kind'] = r.kind === 'dynamic' ? 'filename-expression' : r.kind === 'pattern' ? r.access === 'write' ? 'output-pattern' : 'glob' : r.kind;
    if (r.role === 'image' && r.path && r.selector) kind = 'image-selector';
    references.push({ value, path: r.path, access: r.access,
      kind, literal: r.kind === 'path', source: r.source, filenameDialect: kind === 'filename-expression' || kind === 'output-pattern' ? 'imagemagick' : undefined, index: r.index, stage: 'incremental', grammar: r.role === 'script' ? discovery.command === 'conjure' ? 'msl' : 'magick-script' : r.role === 'list' ? 'magick-list' : r.role === 'text' ? 'text' : undefined });
  }
  for (const token of discovery.tokens) if (byteText(token.raw).toLowerCase() === '-draw' && token.values[0]) {
    const value = token.values[0];
    // DrawImage's FileToString path excludes a bare @ and every @- prefix.
    // Modern property interpretation can still consume @- as text stdin;
    // that separate prediction must not become a drawing filename.
    const indirect = value.length > 1 && value[0] === 64 && value[1] !== 45;
    const reference: AccessReference = { value, path: indirect ? value.slice(1) : undefined, kind: indirect ? 'path' : 'synthetic', literal: indirect, access: 'read', grammar: 'mvg', source: token.source, index: token.index, stage: 'incremental' };
    const next = references.findIndex(r => r.source === token.source && (r.index ?? 0) > token.index);
    references.splice(next < 0 ? references.length : next, 0, reference);
    if (!indirect) inline.set(reference, value);
  }
  // Lookup names deliberately stay out of the local path namespace.
  for (const token of discovery.tokens) if (byteText(token.raw).toLowerCase() === '-font' && token.values[0] && !discovery.resources.some(r => r.source === token.source && r.index === token.index && r.role === 'font')) {
    const next = references.findIndex(r => r.source === token.source && (r.index ?? 0) > token.index);
    references.splice(next < 0 ? references.length : next, 0, { value: token.values[0], kind: 'resource-lookup', access: 'read', source: token.source, index: token.index, stage: 'incremental' });
  }
  return { references, inline };
}
