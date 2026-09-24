import { Budget, UnrtfError, type UnrtfOptions } from './contracts.js';
import { tokenizeRtf } from './tokenizer.js';

/** Explicit inventory. Availability is checked in the current JS realm; no
 * ambient iconv, locale, charmap files or fallback codecs are consulted. */
export const codecLabels: Readonly<Record<number, string>> = Object.freeze({
  437:'ibm437', 850:'ibm850', 874:'windows-874', 932:'shift_jis', 936:'gbk', 949:'euc-kr', 950:'big5',
  1250:'windows-1250', 1251:'windows-1251', 1252:'windows-1252', 1253:'windows-1253',
  1254:'windows-1254', 1255:'windows-1255', 1256:'windows-1256', 1257:'windows-1257',
  1258:'windows-1258', 10000:'macintosh', 65001:'utf-8',
});
export const charsetCodePages: Readonly<Record<number, number>> = Object.freeze({
  0:1252, 1:0, 2:42, 77:10000, 78:10001, 79:10003, 80:10008, 81:10002,
  83:10005, 84:10004, 85:10006, 86:10081, 87:10021, 88:10029, 89:10007,
  128:932, 129:949, 130:1361, 134:936, 136:950, 161:1253, 162:1254,
  163:1258, 177:1255, 178:1256, 186:1257, 204:1251, 222:874, 238:1250, 254:437,
});
export interface RtfFont { id: number; name: string; codePage: number; charset: number | undefined }
export type RtfEvent =
  | {kind:'open' | 'close'; offset:number}
  | {kind:'text'; text:string; offset:number; boundary?:'par'|'line'}
  | {kind:'control'; name:string; parameter:number | undefined; offset:number}
  | {kind:'font'; font:RtfFont; offset:number}
  | {kind:'color'; index:number; rgb:string | undefined; offset:number}
  | {kind:'skipped'; destination:string; offset:number};
interface FontDeclaration {
  id:number; name:string; page:number | undefined; charset:number | undefined;
  decoder?:TextDecoder; activePage?:number; fallback:number; high?:number; ended:boolean;
}
interface State {
  uc:number; page:number; font:number | undefined; destination:string; skip:boolean; starred:boolean;
  declaration: FontDeclaration | undefined;
}
const inert = new Set(['object','objdata','pict','fldinst','filetbl','datastore','datafield','themedata','info','stylesheet','header','footer']);

/** Standards-correct extraction, not GNU 0.21.10 personality rendering.
 * Unknown controls are exposed for a renderer to admit or reject explicitly. */
export async function* extractRtf(source: AsyncIterable<Uint8Array>, options: UnrtfOptions, budget = new Budget(options), accountOutput = true): AsyncGenerator<RtfEvent> {
  const fonts = new Map<number,RtfFont>(), stack: State[] = [];
  let state: State = {uc:1,page:1252,font:undefined,destination:'',skip:false,starred:false,declaration:undefined};
  let colorIndex = 0, color: {red?:number;green?:number;blue?:number} = {};
  let defaultFont:number | undefined;
  let retainedDeclarations = 0;
  let decoder: TextDecoder | undefined, activePage:number | undefined, fallback = 0, high:number | undefined, lastSpace = false;
  const codec = (page:number, offset:number): TextDecoder => {
    const label = codecLabels[page];
    if (!label) throw new UnrtfError('E_CODEC', `Code page ${page} is unavailable`, offset);
    try { return new TextDecoder(label, {fatal:true, ignoreBOM:true}); }
    catch { throw new UnrtfError('E_CODEC', `Codec ${label} is unavailable in this realm`, offset); }
  };
  const appendName = (decl:FontDeclaration, text:string, offset:number):void => {
    let bytes = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    budget.bound('tokenBytes',decl.name.length * 2 + text.length * 2,offset);
    budget.charge('decodedBytes',bytes,offset);
    budget.charge('retainedBytes',text.length * 2,offset);
    retainedDeclarations += text.length * 2;
    decl.name += text;
  };
  const flushName = (decl:FontDeclaration, offset:number):void => {
    if (decl.high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired surrogate in font name',offset);
    if (!decl.decoder) return;
    let text:string;
    try { text = decl.decoder.decode(); }
    catch { throw new UnrtfError('E_ENCODING','Incomplete encoded font name',offset); }
    finally { delete decl.decoder; delete decl.activePage; }
    appendName(decl,text,offset);
  };
  const finishFont = (decl:FontDeclaration, offset:number): Extract<RtfEvent, {kind:'font'}> => {
    flushName(decl,offset);
    const name = decl.name.trim();
    const mapped = decl.charset === undefined ? 0 : charsetCodePages[decl.charset] ?? 1252;
    const page = name === 'Symbol' || decl.page === undefined && decl.charset === undefined && name.toLowerCase().includes('symbol') ? 42 : decl.page ?? mapped;
    const font: RtfFont = {id:decl.id,name,codePage:page,charset:decl.charset};
    budget.charge('retainedBytes',128 + name.length * 2,offset);
    retainedDeclarations += 128 + name.length * 2;
    fonts.set(font.id,font); decl.ended = true;
    return {kind:'font',font,offset};
  };
  const flush = (offset:number): string => {
    if (!decoder) return '';
    try { return decoder.decode(); }
    catch { throw new UnrtfError('E_ENCODING', 'Incomplete encoded byte sequence at encoding/group/Unicode boundary', offset); }
    finally { decoder = undefined; activePage = undefined; }
  };
  const output = (text:string, offset:number): Extract<RtfEvent, {kind:'text'}> | undefined => {
    if (!text) return;
    const bytes = new TextEncoder().encode(text).length;
    budget.charge('decodedBytes', bytes, offset); if (accountOutput) budget.charge('outputBytes', bytes, offset);
    lastSpace = text.endsWith(' ');
    return {kind:'text', text, offset};
  };
  const unicode = (unit:number, offset:number): string => {
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (high !== undefined) throw new UnrtfError('E_ENCODING', 'Unpaired high surrogate', offset);
      high = unit; return '';
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      if (high === undefined) throw new UnrtfError('E_ENCODING', 'Unpaired low surrogate', offset);
      const text = String.fromCharCode(high,unit); high = undefined; return text;
    }
    if (high !== undefined) throw new UnrtfError('E_ENCODING', 'Unpaired high surrogate', offset);
    return String.fromCharCode(unit);
  };
  try {
    for await (const token of tokenizeRtf(source, options, budget)) {
      budget.charge('work', 1, token.offset);
      if (state.starred && !state.skip && token.kind !== 'control')
        throw new UnrtfError('E_PARSE', 'Ignorable destination requires a control word', token.offset);
      if (token.kind === 'open' || token.kind === 'close') {
        const event = output(flush(token.offset), token.offset); if (event) yield event;
        fallback = 0; lastSpace = false;
        if (token.kind === 'open') {
          stack.push(state); state = {...state, starred:false, declaration:undefined};
        } else {
          if (state.declaration && !state.declaration.ended) {
            yield finishFont(state.declaration,token.offset);
          }
          state = stack.pop()!;
        }
        yield {kind:token.kind,offset:token.offset};
        continue;
      }
      if (token.kind === 'control') {
        const {name,parameter,offset} = token;
        if (state.skip) continue;
        if (state.starred || inert.has(name)) {
          if (name === 'pict') budget.charge('images',1,offset);
          state.starred = false; state.skip = true; state.destination = name;
          yield {kind:'skipped',destination:name,offset}; continue;
        }
        if (name === 'fonttbl' || name === 'colortbl') { state.destination = name; continue; }
        if (state.destination === 'colortbl') {
          if (name === 'red' || name === 'green' || name === 'blue') {
            if (parameter === undefined || parameter < 0 || parameter > 255) throw new UnrtfError('E_PARSE','Invalid color component',offset);
            color[name] = parameter;
          }
          continue;
        }
        if (state.destination === 'fonttbl') {
          if (name === 'f' && parameter !== undefined) state.declaration = {id:parameter,name:'',page:undefined,charset:undefined,fallback:0,ended:false};
          const decl = state.declaration;
          if (decl && !decl.ended) {
            if (decl.fallback && name !== 'u') { decl.fallback--; continue; }
            if (name === 'cpg' || name === 'fcharset') {
              flushName(decl,offset);
              if (parameter === undefined) throw new UnrtfError('E_PARSE','Missing font encoding parameter',offset);
              if (name === 'cpg') decl.page = parameter; else decl.charset = parameter;
            } else if (name === 'uc') {
              if (parameter === undefined || parameter < 0 || parameter > 32767) throw new UnrtfError('E_PARSE','Invalid Unicode fallback count',offset);
              state.uc = parameter;
            } else if (name === 'u') {
              if (parameter === undefined || parameter < -32768 || parameter > 65535) throw new UnrtfError('E_PARSE','Invalid Unicode unit',offset);
              // A pending high surrogate is allowed only before its Unicode low unit.
              const priorHigh = decl.high; delete decl.high;
              flushName(decl,offset); if (priorHigh !== undefined) decl.high = priorHigh;
              const unit = parameter < 0 ? parameter + 65536 : parameter;
              if (unit >= 0xd800 && unit <= 0xdbff) {
                if (decl.high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired surrogate in font name',offset);
                decl.high = unit;
              } else if (unit >= 0xdc00 && unit <= 0xdfff) {
                if (decl.high === undefined) throw new UnrtfError('E_ENCODING','Unpaired surrogate in font name',offset);
                appendName(decl,String.fromCharCode(decl.high,unit),offset); delete decl.high;
              } else {
                if (decl.high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired surrogate in font name',offset);
                appendName(decl,String.fromCharCode(unit),offset);
              }
              decl.fallback = state.uc;
            }
          }
          continue;
        }
        if (fallback && name !== 'u') { fallback--; continue; }
        if (name === 'uc') {
          if (parameter === undefined || parameter < 0 || parameter > 32767) throw new UnrtfError('E_PARSE','Invalid Unicode fallback count',offset);
          state.uc = parameter; continue;
        }
        if (name === 'u') {
          if (parameter === undefined || parameter < -32768 || parameter > 65535) throw new UnrtfError('E_PARSE','Invalid Unicode unit',offset);
          const prior = output(flush(offset),offset); if (prior) yield prior;
          const event = output(unicode(parameter < 0 ? parameter + 65536 : parameter,offset),offset); if (event) yield event;
          fallback = state.uc; continue;
        }
        if (name === 'plain') {
          const event = output(flush(offset),offset); if (event) yield event;
          state.font = defaultFont;
          const page = (defaultFont === undefined ? undefined : fonts.get(defaultFont)?.codePage) || state.page;
          codec(page,offset);
          yield {kind:'control',name,parameter,offset}; continue;
        }
        const documentPage: Record<string,number> = {ansi:1252,mac:10000,pc:437,pca:850};
        if (documentPage[name] !== undefined) {
          const event = output(flush(offset),offset); if (event) yield event;
          codec(documentPage[name]!,offset); state.page = documentPage[name]!; continue;
        }
        if (name === 'ansicpg' || name === 'cpg' || name === 'f' || name === 'deff') {
          const event = output(flush(offset),offset); if (event) yield event;
          if (parameter === undefined) throw new UnrtfError('E_PARSE','Missing encoding/font parameter',offset);
          if (name === 'f' || name === 'deff') {
            if (name === 'deff') defaultFont = parameter;
            state.font = parameter;
            const font = fonts.get(parameter);
            if (!font && name === 'f') throw new UnrtfError('E_PARSE','Undeclared font',offset);
            if (font?.codePage) codec(font.codePage,offset);
            yield {kind:'control',name,parameter,offset};
          } else { codec(parameter,offset); state.page = parameter; }
          continue;
        }
        const chars: Record<string,string> = {par:'\n',line:'\n',tab:'\t',emdash:'—',endash:'–',bullet:'•',lquote:'‘',rquote:'’',ldblquote:'“',rdblquote:'”'};
        if (chars[name] || name === 'cell' || name === 'row' || name === 'trowd') {
          if (high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired high surrogate before text',offset);
          const prior = output(flush(offset),offset); if (prior) yield prior;
          if (chars[name]) {
            const event = output(chars[name]!,offset); if (event) { if (name === 'par' || name === 'line') event.boundary = name; yield event; }
          } else { lastSpace = false; yield {kind:'control',name,parameter,offset}; }
        } else yield {kind:'control',name,parameter,offset};
        continue;
      }
      if (token.kind === 'symbol' && token.name === '*') { state.starred = true; continue; }
      if (state.destination === 'pict') {
        if (token.kind === 'binary') budget.charge('imageBytes',token.length,token.offset);
        else if (token.kind === 'byte') budget.charge('imageBytes',1,token.offset);
      }
      if (state.skip) continue;
      if (token.kind === 'binary') {
        if (state.destination === 'fonttbl') {
          const decl = state.declaration;
          if (decl?.fallback) decl.fallback--;
          else throw new UnrtfError('E_PARSE','Binary data outside font name Unicode fallback',token.offset);
        } else if (fallback) fallback--;
        continue;
      }
      if (state.destination === 'fonttbl' && token.kind === 'symbol' && (token.name === '~' || token.name === '_')) {
        const decl = state.declaration;
        if (decl && !decl.ended) {
          if (decl.fallback) { decl.fallback--; continue; }
          flushName(decl,token.offset);
          appendName(decl,token.name === '~' ? '\u00a0' : '\u2011',token.offset);
        }
        continue;
      }
      if (fallback && token.kind === 'symbol') { fallback--; continue; }
      let byte:number | undefined;
      if (token.kind === 'byte') byte = token.byte;
      else if (token.kind === 'symbol') {
        if (['{','}','\\','?'].includes(token.name)) byte = token.name.charCodeAt(0);
        else if (token.name === '~' || token.name === '_') {
          if (high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired high surrogate before text',token.offset);
          const prior = output(flush(token.offset),token.offset); if (prior) yield prior;
          const event = output(token.name === '~' ? '\u00a0' : '\u2011',token.offset); if (event) yield event;
        }
      }
      if (byte === undefined) continue;
      if (state.destination === 'colortbl') {
        if (byte === 59) {
          const rgb = Object.keys(color).length ? '#' + [color.red ?? 0,color.green ?? 0,color.blue ?? 0].map(value => value.toString(16).padStart(2,'0')).join('') : undefined;
          budget.charge('retainedBytes',32,token.offset);
          retainedDeclarations += 32;
          yield {kind:'color',index:colorIndex++,rgb,offset:token.offset}; color = {};
        }
        continue;
      }
      if (state.destination === 'fonttbl') {
        const decl = state.declaration;
        if (decl && !decl.ended) {
          if (decl.fallback) { decl.fallback--; continue; }
          if (byte === 59) { yield finishFont(decl,token.offset); continue; }
          if (decl.high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired surrogate in font name',token.offset);
          const page = decl.page ?? (decl.charset === undefined ? state.page : (charsetCodePages[decl.charset] ?? 1252) || state.page);
          // Symbol is a glyph encoding, not an encoding for its ASCII declaration name.
          const namePage = page === 42 ? state.page : page;
          if (decl.activePage !== namePage) {
            flushName(decl,token.offset); decl.decoder = codec(namePage,token.offset); decl.activePage = namePage;
          }
          let text:string;
          try { text = decl.decoder!.decode(Uint8Array.of(byte),{stream:true}); }
          catch { throw new UnrtfError('E_ENCODING','Malformed encoded font name',token.offset); }
          appendName(decl,text,token.offset);
        }
        continue;
      }
      if (fallback) { fallback--; continue; }
      if (high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired high surrogate before text',token.offset);
      if (token.kind === 'byte' && !token.escaped && byte === 32 && lastSpace) continue;
      const page = (state.font === undefined ? undefined : fonts.get(state.font)?.codePage) || state.page;
      if (activePage !== page) {
        const event = output(flush(token.offset),token.offset); if (event) yield event;
        decoder = codec(page,token.offset); activePage = page;
      }
      let decoded:string;
      try { decoded = decoder!.decode(Uint8Array.of(byte),{stream:true}); }
      catch { throw new UnrtfError('E_ENCODING','Malformed encoded byte sequence',token.offset); }
      const event = output(decoded,token.offset); if (event) yield event;
    }
    if (high !== undefined) throw new UnrtfError('E_ENCODING','Unpaired high surrogate at EOF',0);
  } finally {
    budget.release('retainedBytes',retainedDeclarations);
    decoder = undefined; fonts.clear(); stack.length = 0;
  }
}
