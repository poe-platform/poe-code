import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { parseModule } from "../parse/parser.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

describe("for-of assignment targets", () => {
  it("does not repeat target effects when resuming the loop body", async () => {
    const source = "let calls=0;const object={};function target(){calls+=1;return object}for(target().value of [7]){await wait()}return [calls,object.value];";
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = run(source, { bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
    } });
    let snapshot: ReturnType<typeof JSON.parse>;
    try { snapshot = JSON.parse(await dump(original)); }
    finally { release(); await original; }
    expect(await original).toMatchObject({ ok: true, returnValue: [1, 7] });
    expect(await run(source, { snapshot: restore(snapshot, { source }), bindings: {
      wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) })
    } })).toMatchObject({ ok: true, returnValue: [1, 7] });
  });
  it.each([
    ["member", "const target={value:0};for(target.value of [7]){}return target.value;"],
    ["computed member", "const target={};let key='value';for(target[key] of [1,7]){}return target.value;"],
    ["array pattern", "let value=0;for([value] of [[7]]){}return value;"],
    ["object pattern", "let value=0;for({value} of [{value:7}]){}return value;"],
    ["renamed object", "let value=0;for({x:value} of [{x:7}]){}return value;"],
    ["array default", "let value=0;for([value=7] of [[]]){}return value;"],
    ["object default", "let value=0;for({x:value=7} of [{}]){}return value;"],
    ["nested pattern", "let value=0;for([{x:value}] of [[{x:7}]]){}return value;"],
    ["array rest", "let value;let tail;for([value,...tail] of [[1,2,7]]){}return [value,tail];"],
    ["object rest", "let value;let rest;for({x:value,...rest} of [{x:1,y:7}]){}return [value,rest.y];"],
    ["member within array", "const target={};for([target.value] of [[7]]){}return target.value;"],
    ["member within object", "const target={};for({x:target.value} of [{x:7}]){}return target.value;"],
    ["target evaluation order", "const log=[];const object={};function target(){log.push('target');return object}function key(){log.push('key');return 'value'}function values(){log.push('values');return [1,7]}for(target()[key()] of values()){log.push(object.value)}return log;"],
    ["setter", "const seen=[];const target={set value(value){seen.push(value)}};for(target.value of [1,7]){}return seen;"],
    ["setter failure closes", "let closed=false;let called=false;let failure;function* items(){try{yield 1}finally{closed=true}}const target={set value(value){called=true;throw 7}};try{for(target.value of items()){}}catch(e){failure=e}return [called,closed,failure];"],
    ["computed failure closes", "let closed=false;let failure;function* items(){try{yield 1}finally{closed=true}}function key(){throw 7}const target={};try{for(target[key()] of items()){}}catch(e){failure=e}return [closed,failure];"],
    ["default failure closes", "let closed=false;let value;let failure;function* items(){try{yield []}finally{closed=true}}function fail(){throw 7}try{for([value=fail()] of items()){}}catch(e){failure=e}return [closed,failure];"],
    ["null destructuring closes", "let closed=false;let value;let failure;function* items(){try{yield null}finally{closed=true}}try{for({value} of items()){}}catch(e){failure=e.name}return [closed,failure];"],
    ["identifier control", "let value=0;for(value of [7]){}return value;"],
    ["declaration control", "const seen=[];for(const [value] of [[7]]){seen.push(value)}return seen;"],
    ["const assignment rejection", "const value=0;try{for([value] of [[7]]){}}catch(e){return e.name}"],
    ["undeclared assignment rejection", "try{for([missing] of [[7]]){}}catch(e){return e.name}"]
  ])("matches native %s", async (_name, source) => {
    const expected = new Function(`'use strict';${source}`)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "let value;for(value=1 of [7]){}",
    "for(const value=1 of [7]){}",
    "let value;for([...value,] of [[7]]){}"
  ])("rejects invalid native grammar: %s", source => {
    expect(() => new Function(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  });
});
