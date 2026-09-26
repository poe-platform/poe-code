import {expect, it} from "vitest";
import {createEngine, type Codec} from "./index.js";
const codec: Codec = {id: "fixture", description: "fixture", extensions: ["csv"], probeContent: () => true,
  async read(_bytes, context) {
    expect(Object.values(context.limits).every(value => value === Infinity)).toBe(true);
    return {sheets: [{id: "s", name: "S", cells: []}]};
  }, async write() {return new Uint8Array([1]);}};
it.each([undefined, {inputBytes: Infinity}])("converts with omitted or explicit unbounded limits", async limits => {
  const engine = createEngine({codecs: [codec], environment: {env: {}, locale: "C", timezone: "UTC"}, ...(limits ? {limits} : {})});
  const output: Uint8Array[] = [];
  await engine.convert({input: {kind: "stream", source: [new Uint8Array([1])]}, exportType: "fixture",
    destination: {kind: "stream", sink: {async write(bytes) {output.push(bytes);}}}}, {signal: new AbortController().signal});
  expect(output).toEqual([new Uint8Array([1])]);
  await engine.dispose();
});
