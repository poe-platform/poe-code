import {expect,it} from 'vitest';
import {parseWireJson} from './wire-json.js';
it('preserves JSON values, exact key spelling and own prototype-looking fields',()=>{
  const text=String.raw` {"__proto__":{"x":1},"a":[true,false,null,-2.5e2,"quotes \" and {,}"],"\u0062":""} `;
  expect(parseWireJson(text)).toEqual(JSON.parse(text));
  expect(Object.hasOwn(parseWireJson(text) as object,'__proto__')).toBe(true);
  expect(parseWireJson('[{"x":1},{"x":2}]')).toEqual([{x:1},{x:2}]);
  for(const primitive of ['""','0','null','true'])expect(parseWireJson(primitive)).toEqual(JSON.parse(primitive));
});
it('refuses duplicate nested keys and Unicode escape aliases',()=>{
  for(const text of ['{"x":1,"x":2}','{"x":[{"a":1,"\\u0061":2}]}','{"__proto__":1,"__proto__":2}'])expect(()=>parseWireJson(text)).toThrow('Duplicate');
});
it('refuses excessive nesting and malformed JSON without recursive parsing',()=>{
  expect(parseWireJson('['.repeat(64)+'0'+']'.repeat(64))).toBeDefined();
  expect(()=>parseWireJson('['.repeat(65)+'0'+']'.repeat(65))).toThrow('nesting');
  for(const text of ['','{','[}', '{"x":1,}', '{"x":"unterminated}', '[01]', 'NaN', '{}{}'])expect(()=>parseWireJson(text)).toThrow(SyntaxError);
});
