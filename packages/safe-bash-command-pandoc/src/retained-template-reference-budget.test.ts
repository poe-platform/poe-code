import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";

const inputText = (text: string) => ({bytes: new TextEncoder().encode(text)});
const layers: Pick<ConversionOptions, "template" | "variables" | "includeInHeader" | "includeBeforeBody" | "includeAfterBody">[] = [
  {variables: {name: "name", names: ["one", "two"]}},
  {template: inputText("$if(name)$$name$$else$none$endif$:$for(names)$$names$$endfor$:$body$\n"), variables: {name: "name", names: ["one", "two"]}},
  {includeInHeader: [inputText("head")], includeBeforeBody: [inputText("before")], includeAfterBody: [inputText("after")]},
  {template: inputText("$for(names)$$if(show)$$names$$endif$$endfor$"), variables: {show: true, names: ["α".repeat(30), "β".repeat(30)]}},
  {template: inputText("α".repeat(3000) + "$body$"), includeBeforeBody: [inputText("before")]}
];
it.each(["json", "html5", "plain"].flatMap(to => layers.map(layer => ({to, layer}))))("retains template and include reference limits for $to $layer", async ({to, layer}) => {
  const input = {bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{"nested":{"t":"MetaMap","c":{"old":{"t":"MetaString","c":"kept"}}}},"blocks":[{"t":"Para","c":[{"t":"Str","c":"body"}]}]}')};
  for (const outputBytes of [undefined, 0, 50]) for (const references of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 40, 80, 1000]) {
    const options = {from: "json", to, ...layer}, limits = {references, ...(outputBytes === undefined ? {} : {outputBytes})};
    const expected = await convert([input], options, {limits}).catch(error => error);
    if (references === 1000 && outputBytes === undefined && (to === "html5" || !layer.template && !layer.includeInHeader)) expect(expected).not.toBeInstanceOf(Error);
    const fs = new MemoryFileSystem(), bytes: number[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(chunk) {bytes.push(...chunk);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire.mock.calls.length).toBe(0);
      if (expected instanceof Error) {
        expect(actual, JSON.stringify(limits)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
        expect(bytes).toEqual([]);
      } else {
        expect(actual, JSON.stringify(limits)).not.toBeInstanceOf(Error);
        expect(actual.diagnostics).toEqual(expected.diagnostics);
        expect(Uint8Array.from(bytes)).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes);
      }
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
