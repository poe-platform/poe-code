import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

const input = (text: string) => ({bytes: new TextEncoder().encode(text)});
it.each(["json", "rtf", "csv", "tsv"].flatMap(from => ["plain", "html", "json", "rtf", "odt"].map(to => ({from, to}))))("retains $from to $to with finite include budgets", async ({from, to}) => {
  const source = input(from === "json" ? '{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":[]}' : from === "rtf" ? String.raw`{\rtf1 body}` : "head\nvalue");
  for (const template of [null, undefined, input("$header-includes$:$body$")]) for (const includes of [0, 1, 2, 3, 4, 5]) {
    const options = {from, to, ...(template === null ? {} : {...(template ? {template} : {}), includeInHeader: [input("header")], includeBeforeBody: [input("before"), input("second")], includeAfterBody: [input("after")]})};
    const limits = {includes}, expected = await convert([source], options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    const close = vi.fn(async () => {expect(await fs.readdir("/")).toEqual([]);});
    try {
      const result = await convertToOutput([source], options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, close, async abort() {}}}).catch(error => error);
      if (expected instanceof Error) {expect(result).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message}); expect(close).not.toHaveBeenCalled();}
      else {expect(result).not.toBeInstanceOf(Error); expect(Uint8Array.from(parts.flatMap(part => [...part]))).toEqual(expected.kind === "text" ? new TextEncoder().encode(expected.text) : expected.bytes); expect(close).toHaveBeenCalledOnce();}
      expect(acquire).not.toHaveBeenCalled();
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
