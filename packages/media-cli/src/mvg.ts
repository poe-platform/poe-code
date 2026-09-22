import { byteText, textBytes } from './bytes.js';
import type { AccessReference } from './resolution-types.js';
import { imageMagickReaderReferences, parseImageMagickFontOperand } from './imagemagick-operand.js';
/** MVG command boundaries and quoted operands; unknown command shapes stop hints
 * instead of scanning arbitrary drawing text for apparent paths. Native still owns
 * primitive validation, macro execution and property evaluation. */
export async function parseMvg(content: Uint8Array, cwd: Uint8Array, maxNodes: number, filesystem: Parameters<typeof imageMagickReaderReferences>[3] = {}): Promise<{ references: AccessReference[]; complete: boolean; budget: boolean }> {
  const input = byteText(content), references: AccessReference[] = [];
  let i = 0, complete = true, budget = false;
  function next(): string | undefined {
    while (i < input.length) {
      if (' \t\r\n,;'.includes(input[i])) { i++; continue; }
      if (input[i] === '#') { while (i < input.length && input[i] !== '\n') i++; continue; }
      break;
    }
    if (i === input.length) return;
    const quote = ['"', "'"].includes(input[i]) ? input[i++] : undefined;
    let value = '';
    while (i < input.length) {
      const c = input[i];
      if (quote ? c === quote : ' \t\r\n,;'.includes(c)) { if (quote) i++; return value; }
      i++;
      if (c === '\\' && i < input.length && (input[i] === quote || input[i] === '\\')) value += input[i++];
      else value += c;
    }
    if (quote) complete = false;
    return value;
  }
  const arity: Record<string, number> = {
    image: 6, text: 3, font: 1, push: 1, pop: 1, path: 1,
    fill: 1, stroke: 1, 'fill-opacity': 1, 'stroke-opacity': 1, 'stroke-width': 1,
    'font-size': 1, 'font-style': 1, 'font-weight': 1, 'font-family': 1,
    'text-anchor': 1, 'text-align': 1, 'text-decoration': 1, gravity: 1,
    opacity: 1, rotate: 1, translate: 2, scale: 2, skewx: 1, skewy: 1,
    affine: 6, viewbox: 4, point: 2, line: 4, rectangle: 4,
    roundrectangle: 6, circle: 4, ellipse: 6, arc: 6,
    'clip-path': 1, 'clip-rule': 1, 'fill-rule': 1, 'stroke-linecap': 1,
    'stroke-linejoin': 1, 'stroke-miterlimit': 1, 'stroke-dashoffset': 1,
  };
  for (;;) {
    const command = next()?.toLowerCase();
    if (command === undefined) break;
    const count = arity[command];
    if (count === undefined) { complete = false; break; }
    const args: string[] = [];
    for (let n = 0; n < count; n++) { const value = next(); if (value === undefined) { complete = false; break; } args.push(value); }
    if (!complete) break;
    if (command === 'image' || command === 'font') {
      const value = textBytes(args.at(-1)!);
      let resources: AccessReference[];
      if (command === 'font') {
        const font = await parseImageMagickFontOperand(value, {...filesystem, interpretProperties:false});
        resources = [{value, path:font.kind === 'path' ? textBytes(font.name) : undefined, literal:font.kind === 'path',
          access:'read', base:{kind:'directory',value:cwd},
          kind:font.kind === 'lookup' ? 'resource-lookup' : font.kind === 'dynamic' ? 'filename-expression' : 'path'}];
      } else {
        // DrawPrimitive calls ReadInlineImage before any filename/stat lookup.
        resources = args.at(-1)!.slice(0, 5).toLowerCase() === 'data:'
          ? [{value, access:'read', kind:'synthetic'}]
          : await imageMagickReaderReferences(value, cwd, 'read', filesystem);
      }
      for (const reference of resources) {
        if (references.length >= maxNodes) { complete = false; budget = true; break; }
        references.push(reference);
      }
      if (budget) break;
    }
  }
  return { references, complete, budget };
}
