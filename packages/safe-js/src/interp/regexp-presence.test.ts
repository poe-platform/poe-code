import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("RegExp inherited property presence", () => {
  it.each([
    "let reads=0;Object.defineProperty(RegExp.prototype,'marker',{get(){reads++;return 42}});const present='marker' in /a/;return [present,reads];",
    "RegExp.prototype.marker=undefined;return 'marker' in /a/;",
    "const key=Symbol('marker');RegExp.prototype[key]=undefined;return key in /a/;",
    "class Pattern extends RegExp{}Pattern.prototype.marker=undefined;return 'marker' in new Pattern('a');",
    "Object.defineProperty(RegExp.prototype,'marker',{get:undefined});return 'marker' in /a/;",
    "const regex=/a/;Object.setPrototypeOf(regex,null);return ['source' in regex,'lastIndex' in regex];",
    "delete RegExp.prototype.exec;return 'exec' in /a/;"
  ])("matches native: %s", async source => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(function(){'use strict';" + source + "})()") });
  });
});
