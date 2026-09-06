import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";

describe("object destructuring primitive sources", () => {
  it.each([
    ["string properties", "const {length,0:first}='abc';return [length,first];"],
    ["string rest and exclusions", "const {0:first,...rest}='abc';return [first,rest];"],
    [
      "string UTF-16 rest keys",
      "const {...rest}='😀';return [Object.keys(rest),rest[0].charCodeAt(0),rest[1].charCodeAt(0)];"
    ],
    ["number default and rest", "const {missing=7,...rest}=42;return [missing,rest];"],
    ["boolean empty pattern", "const {}=false;return 7;"],
    [
      "symbol properties and rest",
      "const {description,...rest}=Symbol('key');return [description,rest];"
    ],
    [
      "number prototype getter receiver",
      "Object.defineProperty(Number.prototype,'field',{get(){return typeof this+':'+this.valueOf()}});const {field}=7;return field;"
    ],
    [
      "string prototype getter receiver",
      "Object.defineProperty(String.prototype,'field',{get(){return typeof this+':'+this.valueOf()}});const {field}='abc';return field;"
    ],
    ["assignment", "let length,first;({length,0:first}='abc');return [length,first];"],
    ["parameter", "function read({length,...rest}){return [length,rest]}return read('ab');"],
    ["nested primitive", "const {value:{length,0:first}}={value:'abc'};return [length,first];"],
    [
      "null rejects before key evaluation",
      "let calls=0;function key(){calls++;return 'x'}try{const {[key()]:value}=null}catch(error){return [error.name,calls]}"
    ],
    ["undefined empty pattern rejects", "try{const {}=undefined}catch(error){return error.name}"]
  ])("matches native %s", async (_name, source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
