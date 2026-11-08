import { describe, expect, it } from "vitest";
import { lint } from "./index.js";
import { run } from "../core.js";

describe("supported guest prototype access", () => {
  it.each([
    "Object.prototype.toString.call({});",
    "function Box(){} Box.prototype.value=7;",
    "const object={constructor:7}; object.constructor;"
  ])("does not reject guest-supported syntax: %s", (source) => {
    expect(lint(source).filter((diagnostic) => diagnostic.code === "AS011")).toEqual([]);
  });
  it("runs guest prototype and constructor properties", async () => {
    expect(
      await run(
        "function Box(){}Box.prototype.value=7;return [new Box().value,Box.prototype.constructor===Box,({constructor:9}).constructor];"
      )
    ).toMatchObject({ ok: true, returnValue: [7, true, 9] });
  });
  it("exposes only the sandbox function prototype for native capabilities", async () => {
    const host = () => 7;
    expect(
      await run(
        "const key='constructor';return [host.constructor===Function,host.prototype,host.__proto__===Function.prototype,host[key]===Function,Object.getPrototypeOf(host)===Object.getPrototypeOf(function(){}),host.bind(null).constructor===Function,host.call.constructor===Function,host.constructor('return [typeof process,typeof require,typeof Buffer]')()];",
        { bindings: { host } }
      )
    ).toMatchObject({
      ok: true,
      returnValue: [true, undefined, true, true, true, true, true, ["undefined","undefined","undefined"]]
    });
  });
});
