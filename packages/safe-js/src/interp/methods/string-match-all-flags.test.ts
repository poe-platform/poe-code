import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";

describe("matchAll observable clone flags", () => {
  it.each([
    "let reads=0;const log=[];const regex=/a/g;Object.defineProperty(regex,'flags',{get(){return ++reads===1?'g':'gg'}});regex.lastIndex={valueOf(){log.push('cursor');return 0}};try{return 'a'.matchAll(regex)}catch(error){return [error.name,log]}",
    "let reads=0;const log=[];const regex=/a/g;Object.defineProperty(regex,'flags',{get(){return ++reads===1?'g':Symbol('flags')}});regex.lastIndex={valueOf(){log.push('cursor');return 0}};try{return 'a'.matchAll(regex)}catch(error){return [error.name,log]}",
    "const regex=/a/g;Object.defineProperty(regex,'flags',{value:'gi',configurable:true});regex.lastIndex=1;const iterator='AA'.matchAll(regex);regex.lastIndex=0;Object.defineProperty(regex,'flags',{value:'g'});return [Array.from(iterator,match=>match.index),regex.lastIndex];",
    "const regex=/a/g;Object.defineProperty(regex,'ignoreCase',{value:true});return Array.from('A'.matchAll(regex),match=>match[0]);",
    "const regex=/a/g;Object.defineProperty(regex,'flags',{value:'gi'});return Array.from('A'.matchAll(regex),match=>match[0]);",
    "const log=[];const regex=/a/g;Object.defineProperty(regex,'flags',{get(){log.push('flags');return 'gi'}});regex.lastIndex={valueOf(){log.push('cursor');return 0}};return [Array.from('A'.matchAll(regex),match=>match[0]),log];",
    "const log=[];const regex=/a/g;Object.defineProperty(regex,'flags',{get(){log.push('flags');return log.length===1?'g':'i'}});return [Array.from('AA'.matchAll(regex),match=>match[0]),log];",
    "let reads=0;const regex=/a/g;Object.defineProperty(regex,'flags',{get(){if(++reads===2)throw 'clone';return 'g'}});regex.lastIndex={valueOf(){throw 'cursor'}};try{return 'a'.matchAll(regex)}catch(error){return [error,reads]}",
    "let reads=0;const regex=/a/g;Object.defineProperty(regex,'flags',{get(){if(++reads===2)regex.lastIndex=1;return 'g'}});return [Array.from('aa'.matchAll(regex),match=>match.index),regex.lastIndex,reads];",
    "const log=[];const regex=/a/g;Object.defineProperty(regex,'flags',{get(){log.push('get');return {toString(){log.push('string');return 'gi'}}}});regex.lastIndex={valueOf(){log.push('cursor');return 0}};return [Array.from('A'.matchAll(regex),match=>match[0]),log];",
    "const regex=/a/g;Object.defineProperty(regex,'source',{get(){throw 'source'}});Object.defineProperty(regex,'flags',{value:'gi'});return Array.from('A'.matchAll(regex),match=>match[0]);"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
