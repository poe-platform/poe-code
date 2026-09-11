import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRealm, defineExtension, run } from "../core.js";

describe("object extensibility and sealing", () => {
  it.each(["preventExtensions", "seal"])("does not apply %s to live host objects", async (method) => {
    const realm = createRealm({ extensions: [defineExtension({
      manifest: { version: 1, name: "live", globals: ["live"] },
      setup(context) {
        return { globals: { live: context.createHostObject({ properties: { x: { get: () => 7 } } }) } };
      }
    })] });
    try {
      expect(await realm.evaluate(`try{Object.${method}(live)}catch(error){return [error.name,live.x]}`))
        .toMatchObject({ returnValue: ["TypeError", 7] });
    } finally {
      await realm.close();
    }
  });
  it.each([
    "const value={x:1};return [Object.isExtensible(value),Object.preventExtensions(value)===value,Object.isExtensible(value)];",
    "const value={x:1};Object.preventExtensions(value);value.x=2;delete value.x;return Object.keys(value);",
    "const value={};Object.preventExtensions(value);try{value.x=1}catch(error){return error.name}",
    "const value=[];Object.preventExtensions(value);try{value.push(1)}catch(error){return [error.name,value.length]}",
    "function value(){}Object.preventExtensions(value);try{value.extra=1}catch(error){return [error.name,Object.isExtensible(value)]}",
    "const value={x:1};return [Object.seal(value)===value,Object.isSealed(value),Object.isFrozen(value),Object.isExtensible(value),Object.getOwnPropertyDescriptor(value,'x')];",
    "const value={x:1};Object.seal(value);value.x=2;try{delete value.x}catch(error){return [error.name,value.x]}",
    "const value=[1];Object.seal(value);value[0]=2;return [Object.isSealed(value),Object.isFrozen(value),value[0]];",
    "function value(){}Object.seal(value);return [Object.isSealed(value),Object.isExtensible(value)];",
    "const value={};Object.preventExtensions(value);return [Object.isSealed(value),Object.isFrozen(value)];",
    "return [undefined,null,7,'text',true,Symbol('x')].map(value=>[Object.preventExtensions(value)===value,Object.seal(value)===value,Object.isExtensible(value),Object.isSealed(value)]);",
    "let saved=0;const value={set x(next){saved=next}};Object.seal(value);value.x=7;return [saved,Object.isSealed(value)];"
  ])("matches native: %s", async (source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
