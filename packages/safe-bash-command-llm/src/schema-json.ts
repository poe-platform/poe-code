import {yieldTurn} from 'safe-bash-contracts/yield';
// Keep object insertion order and Python's integer/float distinction. Ordinary
// JSON.parse loses both before the display formatter has a chance to use them.
type Value = string | boolean | null | {number: string} | Value[] | Map<string, Value>;

function parse(text: string, signal: AbortSignal): Value {
  let offset = 0;
  const fail = (): never => { throw new SyntaxError('Invalid schema JSON'); };
  const space = (): void => { while (' \n\r\t'.includes(text[offset] ?? '\0')) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    return fail();
  };
  const value = (): Value => {
    signal.throwIfAborted(); space();
    const char = text[offset];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      offset++; space();
      const object = char === '{', end = object ? '}' : ']';
      const entries = new Map<string, Value>(), array: Value[] = [];
      if (text[offset] !== end) while (true) {
        if (object) {
          if (text[offset] !== '"') return fail();
          const key = string(); space();
          if (text[offset++] !== ':') return fail();
          entries.set(key, value());
        } else array.push(value());
        space();
        if (text[offset] === end) break;
        if (text[offset++] !== ',') return fail();
        space();
      }
      offset++;
      return object ? entries : array;
    }
    for (const [token, result] of [['null', null], ['true', true], ['false', false]] as const) {
      if (text.startsWith(token, offset)) { offset += token.length; return result; }
    }
    for (const token of ['NaN', 'Infinity', '-Infinity']) {
      if (text.startsWith(token, offset)) { offset += token.length; return {number: token}; }
    }
    const start = offset;
    while (offset < text.length && '-+0123456789.eE'.includes(text[offset]!)) offset++;
    const token = text.slice(start, offset);
    if (!token || typeof JSON.parse(token) !== 'number') return fail();
    return {number: token};
  };
  const result = value(); space();
  if (offset !== text.length) fail();
  return result;
}

function numberText(raw: string): string {
  if (raw === 'NaN' || raw.includes('Infinity')) return raw;
  if (!raw.includes('.') && !raw.includes('e') && !raw.includes('E')) return BigInt(raw).toString();
  const value = Number(raw);
  if (!Number.isFinite(value)) return value < 0 ? '-Infinity' : 'Infinity';
  if (Object.is(value, -0)) return '-0.0';
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 0.0001 || absolute >= 1e16)) {
    const [mantissa, exponent] = value.toExponential().split('e') as [string, string];
    const sign = exponent.startsWith('-') ? '-' : '+';
    const digits = exponent.slice(1).padStart(2, '0');
    return mantissa + 'e' + sign + digits;
  }
  const result = String(value);
  return result.includes('.') ? result : result + '.0';
}

export interface SchemaJsonOptions {indent?:number|null;linePrefix?:string;trailingNewline?:boolean;compact?:boolean}

/** Format admitted JSON controls without retaining the expanded ASCII output. */
export async function* schemaJsonChunks(text:string,signal:AbortSignal,options:SchemaJsonOptions={}):AsyncIterable<string>{
 const indent=options.compact?null:options.indent===undefined?2:options.indent;
 const prefix=options.linePrefix??'',root=parse(text,signal);
 function* string(value:string):Generator<string>{
  let output='"';
  for(let index=0;index<value.length;index++){
   const code=value.charCodeAt(index),char=value[index]!;
   output+=code>=127?'\\u'+code.toString(16).padStart(4,'0'):
    code<32||char==='"'||char==='\\'?JSON.stringify(char).slice(1,-1):char;
   if(output.length>=8192){signal.throwIfAborted();yield output;output='';}
  }
  yield output+'"';
 }
 function* render(value:Value,depth:number):Generator<string>{
  signal.throwIfAborted();
  if(typeof value==='string'){yield* string(value);return;}
  if(value===null||typeof value==='boolean'){yield String(value);return;}
  if(!(value instanceof Map)&&!Array.isArray(value)){yield numberText(value.number);return;}
  const object=value instanceof Map;yield object?'{':'[';let count=0;
  for(const [key,child]of value.entries()){
   yield indent===null?(count++?(options.compact?',':', '):''):(count++?',\n':'\n')+prefix+' '.repeat(indent*(depth+1));
   if(object){yield* string(String(key));yield options.compact?':':': ';}
   yield* render(child,depth+1);
  }
  if(count&&indent!==null)yield '\n'+prefix+' '.repeat(indent*depth);
  yield object?'}':']';
 }
 function* pieces():Generator<string>{yield prefix;yield* render(root,0);if(options.trailingNewline!==false)yield '\n';}
 let output='',steps=0;
 for(const piece of pieces()){
  if(++steps%1024===0)await yieldTurn(signal);
  for(let offset=0;offset<piece.length;offset+=8192){
   signal.throwIfAborted();output+=piece.slice(offset,offset+8192);
   if(output.length>=8192){yield output;output='';}
  }
 }
 signal.throwIfAborted();if(output)yield output;
}

/** Render stored JSON with Python json.dumps semantics; legacy display defaults
 * remain indent=2, while schema identities explicitly select compact output. */
export async function renderSchemaJson(text:string,emit:(text:string)=>Promise<void>,signal:AbortSignal,options:SchemaJsonOptions={}):Promise<void>{
 for await(const chunk of schemaJsonChunks(text,signal,options)){await emit(chunk);signal.throwIfAborted();}
}

/** Pinned concise schema summary, retaining source property order. */
export function summarizeSchemaJson(text: string, signal: AbortSignal): string {
  const summarize = (value: Value | undefined): string => {
    signal.throwIfAborted();
    if (!(value instanceof Map)) return '';
    if (value.get('type') === 'array') return summarize(value.get('items'));
    if (value.get('type') !== 'object') return '';
    const properties = value.get('properties');
    if (properties === undefined) return '{}';
    if (!(properties instanceof Map)) throw new TypeError('Invalid schema properties');
    const parts: string[] = [];
    for (const [name, property] of properties) {
      if (!(property instanceof Map)) throw new TypeError('Invalid schema property');
      const type = property.get('type');
      parts.push(type === 'array' ? name + ': [' + summarize(property.get('items')) + ']' :
        type === 'object' ? name + ': ' + summarize(property) : name);
    }
    return '{' + parts.join(', ') + '}';
  };
  return summarize(parse(text, signal));
}
