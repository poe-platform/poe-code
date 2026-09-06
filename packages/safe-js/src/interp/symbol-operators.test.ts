import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("Symbol.toPrimitive operators", () => {
  it.each(["value+2", "2+value", "value-2", "value*2", "value/2", "value%2", "value**2", "value<8", "value>=8", "value==7", "7==value", "value!=7", "value&3", "value<<1", "+value", "-value", "~value"])("matches native conversion for %s", expression => {
    const source = `const log=[];const value={[Symbol.toPrimitive](hint){log.push(hint);return 7}};const result=${expression};return [result,log];`;
    const expected = new Function(source)();
    return expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });
  it.each(["+=", "-=", "*=", "**=", "&="])("matches native compound %s", operator => {
    const source = `const log=[];let value={[Symbol.toPrimitive](hint){log.push(hint);return 7}};value${operator}2;return [value,log];`;
    return expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: new Function(source)() });
  });
  it("does not coerce objects in strict, object-object, or null equality", async () => {
    const source = "let calls=0;const object={[Symbol.toPrimitive](){calls++;return 7}};return [object===7,object=={},object==null,object==undefined,object==object,calls];";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });
  it.each([
    "return typeof Date.prototype[Symbol.toPrimitive];",
    "return Date.prototype[Symbol.toPrimitive].call(new Date(7),'number');",
    "const object={toString(){return 'text'},valueOf(){return 7}};const convert=Date.prototype[Symbol.toPrimitive];return [convert.call(object,'default'),convert.call(object,'string'),convert.call(object,'number')];",
    "const object={[Symbol.toPrimitive](){throw new Error('must not recurse')},valueOf(){return 7}};return Date.prototype[Symbol.toPrimitive].call(object,'number');",
    "try{return Date.prototype[Symbol.toPrimitive].call({},'invalid')}catch(error){return error.name}",
    "try{return Date.prototype[Symbol.toPrimitive].call(7,'number')}catch(error){return error.name}",
    "const date=new Date(0);Object.defineProperty(date,Symbol.toPrimitive,{value:null});return date+1;",
    "const date=new Date(0);Object.defineProperty(date,Symbol.toPrimitive,{value:undefined});return date+1;",
    "const log=[];const left={[Symbol.toPrimitive](hint){log.push('left:'+hint);return 7}};const right={[Symbol.toPrimitive](hint){log.push('right:'+hint);return 2}};const result=left+right;return [result,log];",
    "const log=[];const left={[Symbol.toPrimitive](){log.push('coerce');return 7}};function right(){log.push('right');return 2}const result=left+right();return [result,log];",
    "let reads=0;const object={get [Symbol.toPrimitive](){reads++;return hint=>hint==='default'?7:3}};return [object+2,reads];",
    "const key=Symbol('key');const object={[Symbol.toPrimitive](){return key}};return [object==key,key==object];",
    "try{return 1+{[Symbol.toPrimitive]:7}}catch(error){return error.name}",
    "try{return 1+{[Symbol.toPrimitive](){return {}}}}catch(error){return error.name}"
  ])("preserves conversion order and errors: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });
});
