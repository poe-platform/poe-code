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
  it("keeps native host function prototypes hidden for literal and computed keys", async () => {
    const host = () => 7;
    expect(
      await run(
        "const key='constructor';return [host.constructor,host.prototype,host.__proto__,host[key],Object.getPrototypeOf(host),host.bind(null).constructor,host.call.constructor];",
        { bindings: { host } }
      )
    ).toMatchObject({
      ok: true,
      returnValue: [undefined, undefined, undefined, undefined, null, undefined, undefined]
    });
  });
});
