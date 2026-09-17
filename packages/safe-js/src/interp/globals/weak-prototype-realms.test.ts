import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";

it.each(["WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry"])(
  "%s.prototype retains its own realm's Object.prototype across foreign inspection and replay", async name => {
    const nativeValues = runInNewContext(`[${name}.prototype,Object.prototype]`);
    const nativeInspect = runInNewContext("Object.getPrototypeOf");
    expect(nativeInspect(nativeValues[0])).toBe(nativeValues[1]);

    const source = `await 0;return [${name}.prototype,Object.prototype]`;
    const original = await run(source);
    const replayed = await run(source,{snapshot:JSON.parse(await dump(original))});
    const other = (await run("return Object.getPrototypeOf")).returnValue;
    if (!isSandboxClosure(other)) throw new Error("Missing foreign inspector");
    for (const result of [original,replayed]) {
      if (!result.ok || !Array.isArray(result.returnValue)) throw new Error("Missing prototype exports");
      const [prototype,root] = result.returnValue;
      const inspected = await other.call([prototype],{stack:[],thisValue:undefined});
      expect(inspected === root).toBe(true);
    }
  }
);
