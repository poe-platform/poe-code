import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  ["BigInt", "7n"],
  ["Symbol", "Symbol('value')"],
])("boxes a %s receiver before generic Date JSON conversion", async (name, value) => {
  const source = `const value=${value};
    ${name}.prototype.toISOString=function(){return [typeof this,this.valueOf()===value]};
    return Date.prototype.toJSON.call(value);`;
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  ["BigInt", "7n"],
  ["Symbol", "Symbol('value')"],
])("retains the same %s box through coercion and ISO hooks", async (name, value) => {
  const source = `let box;const events=[];
    Object.defineProperty(${name}.prototype,Symbol.toPrimitive,{configurable:true,
      value(hint){box=this;events.push(hint);return 1}});
    Object.defineProperty(${name}.prototype,'toISOString',{configurable:true,
      get(){events.push(this===box);return function(){events.push(this===box);return 'iso'}}});
    return [Date.prototype.toJSON.call(${value}),events];`;
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  ["BigInt", "7n"],
  ["Symbol", "Symbol('value')"],
])("propagates %s primitive conversion errors before ISO lookup", async (name, value) => {
  const source = `const events=[];
    Object.defineProperty(${name}.prototype,Symbol.toPrimitive,{configurable:true,
      value(){events.push('convert');throw 'conversion'}});
    Object.defineProperty(${name}.prototype,'toISOString',{configurable:true,
      get(){events.push('get');return function(){return 'wrong'}}});
    try{Date.prototype.toJSON.call(${value})}catch(error){return [error,events]}`;
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  ["BigInt", "7n"],
  ["Symbol", "Symbol('value')"],
])("coerces the boxed %s receiver before looking up toISOString", async (name, value) => {
  const source = `const events=[];let box;
    Object.defineProperty(${name}.prototype,Symbol.toPrimitive,{configurable:true,
      value(hint){box=this;events.push([hint,typeof this]);return Infinity}});
    Object.defineProperty(${name}.prototype,'toISOString',{configurable:true,
      get(){events.push('get');return function(){return 'wrong'}}});
    const result=Date.prototype.toJSON.call(${value});
    return [result,events,typeof box];`;
  const expected = runInNewContext(`(function(){"use strict";${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
