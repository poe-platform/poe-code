import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("anonymous class names in binding defaults", () => {
  it.each([
    'const {C=class{static n=this.name}}={};return C.n;',
    'const {key:C=class{static n=this.name}}={};return C.n;',
    'const [C=class{static n=this.name}]=[];return C.n;',
    'let C;({C=class{static n=this.name}}={});return C.n;',
    'let C;[C=class{static n=this.name}]=[];return C.n;',
    'function read(C=class{static n=this.name}){return C.n;}return read();',
    'const read=(C=class{static n=this.name})=>C.n;return read();',
    'function read({key:C=class{static n=this.name}}={}){return C.n;}return read();',
    'class Owner{constructor(C=class{static n=this.name}){this.n=C.n;}}return new Owner().n;',
    'try{throw {};}catch({C=class{static n=this.name}}){return C.n;}',
    'const names=[];for(const [C=class{static n=this.name}] of [[],[]])names.push(C.n);return names;',
    'const {C=class Named{static n=this.name}}={};return C.n;',
    'const {C=true?class{static n=this.name}:null}={};return C.n;',
    'const target={};[target.C=class{static n=this.name}]=[];return target.C.n;',
    'const Existing=class{static n=this.name};const {C=class{static n=this.name}}={C:Existing};return C.n;',
    'class Owner{field=class{static n=this.name};}return new Owner().field.n;'
  ])("matches native named evaluation: %s", async source => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
