import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRealm, defineExtension } from "../core.js";

describe("object rest skips excluded host reads", () => {
  it.each([
    "const {x,...rest}=value;return [x,rest.y];",
    "let x,rest;({x,...rest}=value);return [x,rest.y];",
    "function f({x,...rest}){return [x,rest.y]}return f(value);",
    "const f=({x,...rest})=>[x,rest.y];return f(value);",
    "async function f({x,...rest}){return [x,rest.y]}return await f(value);",
    "const {x,y,...rest}=value;return [x,y,Object.keys(rest)];",
    "const {[{toString(){return 'x'}}]:x,...rest}=value;return [x,rest.y];",
    "const {x:first,x:second,...rest}=value;return [first,second,rest.y];",
    "const {...rest}=value;return [rest.x,rest.y];",
    "const rest={...value};return [rest.x,rest.y];"
  ])("matches observable native reads: %s", async (source) => {
    const nativeReads: string[] = [];
    const nativeValue = Object.defineProperties({}, {
      x: { enumerable: true, get() { nativeReads.push("x"); return 7; } },
      y: { enumerable: true, get() { nativeReads.push("y"); return 8; } }
    });
    // CopyDataProperties excludes keys before Get. A transparent Proxy avoids
    // Node 22's ordinary-object fast path, which can reread an excluded getter.
    const expected = await runInNewContext(`(async()=>{${source}})()`, {
      value: new Proxy(nativeValue, {})
    }, { timeout: 1000 });

    const reads: string[] = [];
    const extension = defineExtension({
      manifest: { version: 1, name: "rest-reads", globals: ["value"] },
      setup(context) {
        const value = context.createHostObject({ properties: {
          x: { get() { reads.push("x"); return 7; } },
          y: { get() { reads.push("y"); return 8; } }
        } });
        return { globals: { value } };
      }
    });
    const realm = createRealm({ extensions: [extension] });
    try {
      expect(await realm.evaluate(source)).toMatchObject({ ok: true, returnValue: expected });
      expect(reads).toEqual(nativeReads);
    } finally {
      await realm.close();
    }
  });

  it("does not invoke an excluded getter that throws on a second read", async () => {
    let reads = 0;
    const extension = defineExtension({
      manifest: { version: 1, name: "single-read", globals: ["value"] },
      setup(context) {
        const value = context.createHostObject({ properties: {
          x: { get() { if (++reads > 1) throw new Error("duplicate read"); return 7; } },
          y: { get: () => 8 }
        } });
        return { globals: { value } };
      }
    });
    const realm = createRealm({ extensions: [extension] });
    try {
      expect(await realm.evaluate("const {x,...rest}=value;return [x,rest.y];"))
        .toMatchObject({ ok: true, returnValue: [7, 8] });
      expect(reads).toBe(1);
    } finally {
      await realm.close();
    }
  });
});
