import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";

describe("replacement and split fallback decisions", () => {
  it.each([
    "const regex=/a/;const receiver={toString(){regex[Symbol.replace]=null;return 'aba'}};return ''.replace.call(receiver,regex,'X');",
    "const regex=/a/;const receiver={toString(){regex[Symbol.split]=null;return 'aba'}};return ''.split.call(receiver,regex);",
    "const regex=/a/;const replacement={toString(){regex[Symbol.replace]=null;return 'X'}};return 'aba'.replace(regex,replacement);",
    "const regex=/a/g;const replacement={toString(){regex[Symbol.replace]=null;return 'X'}};return 'aba'.replaceAll(regex,replacement);",
    "const regex=/a/;Object.defineProperty(regex,Symbol.replace,{configurable:true,get(){delete regex[Symbol.replace];return null}});return 'a/a/'.replace(regex,'X');",
    "const regex=/a/g;Object.defineProperty(regex,Symbol.replace,{configurable:true,get(){delete regex[Symbol.replace];return undefined}});return 'a/a/g'.replaceAll(regex,'X');",
    "const regex=/a/;Object.defineProperty(regex,Symbol.split,{configurable:true,get(){delete regex[Symbol.split];return null}});return 'a/a/'.split(regex);",
    "const regex=/a/g;regex[Symbol.replace]=null;const receiver={toString(){delete regex[Symbol.replace];return 'a/a/g'}};return ''.replaceAll.call(receiver,regex,'X');",
    "const regex=/a/;regex[Symbol.split]=null;const receiver={toString(){delete regex[Symbol.split];return 'a/a/'}};return ''.split.call(receiver,regex);",
    "const log=[];const regex=/a/;Object.defineProperty(regex,Symbol.replace,{configurable:true,get(){log.push('hook');delete regex[Symbol.replace];return null}});regex.toString=()=>{log.push('search');return 'a'};const replacement={toString(){log.push('replacement');return 'X'}};return ['aba'.replace(regex,replacement),log];",
    "const log=[];const regex=/a/;Object.defineProperty(regex,Symbol.split,{configurable:true,get(){log.push('hook');delete regex[Symbol.split];return null}});regex.toString=()=>{log.push('separator');return ','};const limit={valueOf(){log.push('limit');return 1}};return ['a,b'.split(regex,limit),log];"
  ])("matches native: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
