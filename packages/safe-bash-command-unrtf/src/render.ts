import { Budget, UnrtfError, type UnrtfOptions } from './contracts.js';
import { extractRtf } from './extract.js';

export interface UnrtfRenderOptions extends UnrtfOptions { format: 'text' | 'html' }
interface Style { bold:boolean; italic:boolean; underline:boolean; strike:boolean; font?:number; size?:number; color?:string }
const normal: Style = {bold:false,italic:false,underline:false,strike:false};

/** Strict UTF-8 projection. This is deliberately not a GNU output personality. */
export async function* renderRtf(source:AsyncIterable<Uint8Array>, options:UnrtfRenderOptions, budget = new Budget(options)):AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder(), html = options.format === 'html';
  if (!html && options.format !== 'text') throw new UnrtfError('E_PROFILE','Unsupported output format',0);
  let style = {...normal}, paragraph = false, table = false, row = false, cell = false;
  let defaultFont:number | undefined;
  const stack:Style[] = [], fonts = new Map<number,string>(), colors = new Map<number,string | undefined>();
  const emit = (text:string, offset:number):Uint8Array => {
    // All fragments are bounded by one decoded event plus fixed markup.
    budget.charge('work',text.length,offset);
    let length = 0;
    for (const char of text) { const code = char.codePointAt(0)!; length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
    budget.charge('outputBytes',length,offset);
    const working = text.length * 2 + length;
    budget.charge('retainedBytes',working,offset);
    try { return encoder.encode(text); } finally { budget.release('retainedBytes',working); }
  };
  const endParagraph = ():string => { if (!paragraph) return ''; paragraph = false; return '</p>'; };
  const beginText = ():string => {
    if (table) { if (!row) throw new UnrtfError('E_PARSE','Text outside table row',0); if (!cell) { cell = true; return '<td>'; } return ''; }
    if (!paragraph) { paragraph = true; return '<p>'; } return '';
  };
  const styled = (text:string):string => {
    let start = '', end = '';
    for (const [enabled,tag] of [[style.bold,'strong'],[style.italic,'em'],[style.underline,'u'],[style.strike,'s']] as const)
      if (enabled) { start += `<${tag}>`; end = `</${tag}>` + end; }
    const css:string[] = [];
    const fontId = style.font ?? defaultFont;
    const font = fontId === undefined ? undefined : fonts.get(fontId);
    if (font !== undefined) {
      budget.charge('work',font.length * 2,0);
      budget.bound('retainedBytes',font.length * 16,0);
      let name = '';
      for (const char of font) {
        const code = char.codePointAt(0)!;
        name += code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || char === ' ' || char === '-' ? char : '\\' + code.toString(16) + ' ';
      }
      css.push('font-family:&#39;' + name + '&#39;');
    }
    if (style.size !== undefined) css.push('font-size:' + style.size / 2 + 'pt');
    if (style.color !== undefined) css.push('color:' + style.color);
    if (css.length) { start += '<span style="' + css.join(';') + '">'; end = '</span>' + end; }
    return start + text + end;
  };
  let preamble:Uint8Array | undefined;
  try {
    // Admit markup before input acquisition, but do not publish a document
    // until the source has produced an event (opening a VFS file can fail).
    preamble = html ? emit('<!DOCTYPE html><html><body>',0) : undefined;
    if (preamble) budget.charge('retainedBytes',preamble.length,0);
    for await (const event of extractRtf(source, options, budget, false)) {
      if (preamble) {
        const bytes = preamble;
        budget.release('retainedBytes',bytes.length); preamble = undefined;
        yield bytes;
      }
      budget.charge('work',1,event.offset);
      if (event.kind === 'open') {
        budget.charge('retainedBytes',32,event.offset); stack.push(style); style = {...style};
      } else if (event.kind === 'close') {
        style = stack.pop()!; budget.release('retainedBytes',32);
      } else if (event.kind === 'font') {
        fonts.set(event.font.id,event.font.name);
      } else if (event.kind === 'color') {
        colors.set(event.index,event.rgb);
      } else if (event.kind === 'text') {
        if (!html) { yield emit(event.text,event.offset); continue; }
        let fragment = '';
        for (const char of event.text) {
          if (char === '\n') {
            if (table || event.boundary === 'line') fragment += beginText() + '<br>';
            else fragment += paragraph ? endParagraph() : '<p></p>';
          } else fragment += beginText() + styled(char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '\t' ? '&#9;' : char);
        }
        if (fragment) yield emit(fragment,event.offset);
      } else if (event.kind === 'control') {
        const {name,parameter,offset} = event;
        if (name === 'plain') style = {...normal};
        else if (name === 'f' || name === 'deff') {
          if (parameter !== undefined) {
            if (name === 'deff') defaultFont = parameter;
            style.font = parameter;
          }
        } else if (name === 'fs') {
          if (parameter === undefined || parameter <= 0 || parameter > 32767) throw new UnrtfError('E_PARSE','Invalid font size',offset);
          style.size = parameter;
        } else if (name === 'cf') {
          if (parameter === undefined || !colors.has(parameter)) throw new UnrtfError('E_PARSE','Undeclared color',offset);
          const color = colors.get(parameter);
          if (color === undefined) delete style.color; else style.color = color;
        }
        else if (name === 'b') style.bold = parameter !== 0;
        else if (name === 'i') style.italic = parameter !== 0;
        else if (name === 'ul' || name === 'ulnone') style.underline = name === 'ul' && parameter !== 0;
        else if (name === 'strike') style.strike = parameter !== 0;
        else if (name === 'trowd') {
          if (row) throw new UnrtfError('E_PARSE','Nested or unterminated table row',offset);
          if (html) { const prefix = endParagraph() + (table ? '' : '<table><tbody>') + '<tr>'; table = true; yield emit(prefix,offset); }
          row = true;
        } else if (name === 'cell') {
          if (!row) throw new UnrtfError('E_PARSE','Cell outside table row',offset);
          if (html) { yield emit(cell ? '</td>' : '<td></td>',offset); cell = false; }
          else yield emit('\t',offset);
        } else if (name === 'row') {
          if (!row) throw new UnrtfError('E_PARSE','Row end outside table',offset);
          if (html) { yield emit((cell ? '</td>' : '') + '</tr></tbody></table>',offset); cell = false; table = false; }
          else yield emit('\n',offset);
          row = false;
        }
      }
    }
    if (row) throw new UnrtfError('E_PARSE','Unterminated table row',0);
    if (html) yield emit(endParagraph() + '</body></html>',0);
  } finally {
    if (preamble) budget.release('retainedBytes',preamble.length);
    budget.release('retainedBytes',stack.length * 32);
    stack.length = 0; fonts.clear(); colors.clear();
  }
}
