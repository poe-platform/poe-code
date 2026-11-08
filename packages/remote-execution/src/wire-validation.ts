import { wireDefinitions } from './wire.generated.js';
interface Schema {
  $ref?: string; type?: string; const?: unknown; enum?: unknown[];
  oneOf?: Schema[]; anyOf?: Schema[]; allOf?:Schema[];not?:Schema; if?:Schema;then?:Schema;else?:Schema; properties?: Record<string, Schema>;
  required?: string[]; additionalProperties?: boolean | Schema; items?: Schema;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number; uniqueItems?: boolean; pattern?: string; format?: string;
}
function invalid(): never { throw new TypeError('Invalid v1 wire record'); }
function decimal(value: string, signed: boolean) {
  const digits = signed && value.startsWith('-') ? value.slice(1) : value;
  if (!digits.length || digits.length > 20 || (digits.length > 1 && digits[0] === '0') || value === '-0' || Array.from(digits).some(c => c < '0' || c > '9')) invalid();
  const n = BigInt(value); if (n < (signed ? -9223372036854775808n : 0n) || n > (signed ? 9223372036854775807n : 18446744073709551615n)) invalid();
}
function visit(schema: Schema, value: unknown): void {
  if (schema.$ref) return validateWire(schema.$ref.split('/').at(-1)!, value);
  if(schema.if){
    let matches=false;try{visit(schema.if,value);matches=true;}catch{/* condition does not match */}
    const branch=matches?schema.then:schema.else;if(branch)visit(branch,value);
  }
  if(schema.not){let matches=false;try{visit(schema.not,value);matches=true;}catch{/* excluded shape */}if(matches)invalid();}
  for(const branch of schema.allOf??[])visit(branch,value);
  if (schema.oneOf || schema.anyOf) {
    let matches = 0;
    for (const branch of schema.oneOf ?? schema.anyOf!) { try { visit(branch, value); matches++; } catch { /* alternative */ } }
    if (matches < 1 || (schema.oneOf && matches !== 1)) invalid();
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) invalid();
  if (schema.enum && !schema.enum.includes(value)) invalid();
  if(schema.required && (!value || typeof value!=='object' || schema.required.some(key=>!Object.hasOwn(value,key))))invalid();
  switch (schema.type) {
    case 'null': if (value !== null) invalid(); break;
    case 'boolean': if (typeof value !== 'boolean') invalid(); break;
    case 'integer': case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) invalid(); break;
    case 'string':
      if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) invalid();
      // These are the schema's three lexical domains, checked without regexes.
      if (schema.pattern) {
        if (schema.pattern.includes('a-f')) { if (value.length !== 64 || Array.from(value).some(c => !'0123456789abcdef'.includes(c))) invalid(); }
        else if (schema.pattern.includes('[0-9]')) decimal(value, schema.pattern.includes('-?'));
        else invalid();
      }
      if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) invalid(); break;
    case 'array':
      if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid();
      if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) invalid();
      for (let index=0;index<value.length;index++){if(!Object.hasOwn(value,index))invalid();visit(schema.items ?? {},value[index]);} break;
    case 'object': if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); break;
  }
  // JSON Schema object constraints also apply when a conditional omits type.
  if(value && typeof value==='object' && !Array.isArray(value)){
      const record = value as Record<string, unknown>;
      if (schema.required?.some(key => !Object.hasOwn(record, key))) invalid();
      for (const [key, v] of Object.entries(record)) {
        const property = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        if (property) visit(property, v);
        else if (schema.additionalProperties === false) invalid();
        else if (typeof schema.additionalProperties === 'object') visit(schema.additionalProperties, v);
      }
  }
}
/** Schema validation grants no file or process authority. Call only after bounding
 * input bytes; admission must additionally check grants, capabilities and sizes. */
export function validateWire(name: string, value: unknown): void {
  if (!Object.hasOwn(wireDefinitions, name)) invalid(); visit(wireDefinitions[name] as Schema, value);
  if(name==='FileOffset'||name==='Timestamp'){
    if(typeof value!=='string')invalid();decimal(value,name==='Timestamp');
    if(name==='FileOffset'&&BigInt(value)>9223372036854775807n)invalid();
  }
}
