import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

describe("object method names", () => {
  it.each([
    'const key="computed";const o={[key](){return 7}};const method=o[key];await wait();return [method.name,method()];',
    "const o={async read(){await Promise.resolve();return 7}};const method=o.read;await wait();return [method.name,await method()];",
    "const o={*read(){yield 7}};const method=o.read;await wait();return [method.name,method().next().value];"
  ])("preserves inferred names across a checkpoint: %s", async (source) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = run(source, {
      bindings: {
        wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
      }
    });
    let snapshot: ReturnType<typeof JSON.parse>;
    try {
      snapshot = JSON.parse(await dump(original));
    } finally {
      release();
      await original;
    }
    const expected = {
      ok: true,
      returnValue: [source.includes('"computed"') ? "computed" : "read", 7]
    };
    expect(await original).toMatchObject(expected);
    expect(
      await run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve())
          })
        },
        snapshot: restore(snapshot, { source })
      })
    ).toMatchObject(expected);
  });

  it.each([
    ["ordinary", "const o={read(){}};return o.read.name;"],
    ["async", "const o={async read(){await Promise.resolve()}};return o.read.name;"],
    ["generator", "const o={*read(){}};return o.read.name;"],
    ["computed", 'const o={["read"](){}};return o.read.name;'],
    ["numeric", "const o={7(){}};return o[7].name;"],
    ["quoted", 'const o={"two words"(){}};return o["two words"].name;'],
    ["proto", "const o={__proto__(){}};return o.__proto__.name;"],
    ["reserved", "const o={return(){}};return o.return.name;"],
    ["alias", "const o={read(){}};const alias=o.read;return alias.name;"],
    ["descriptor", 'const o={read(){}};return Object.getOwnPropertyDescriptor(o.read,"name");'],
    [
      "getter control",
      'const o={get read(){}};return Object.getOwnPropertyDescriptor(o,"read").get.name;'
    ],
    ["explicit expression control", "const o={read:function explicit(){}};return o.read.name;"]
  ])("matches native %s", async (_name, source) => {
    const native = runInNewContext(`(function(){${source}})()`, {}, { timeout: 1000 });
    const result = await run(source);
    if (!result.ok) throw result.error;
    expect(result.returnValue).toEqual(native);
  });
});
