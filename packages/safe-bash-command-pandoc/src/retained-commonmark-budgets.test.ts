import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

it.each(["json", "plain"].flatMap(to => [false, true].flatMap(fileScope => [false, true].map(metadata => ({to, fileScope, metadata})))))("preserves Markdown budgets to $to scope=$fileScope metadata=$metadata", async ({to, fileScope, metadata}) => {
  const text = (metadata ? "---\ntitle: hello\nmap: {key: value}\nlist: [1, 2]\n---\n" : "") + "# Title\n\n*body 😀* [link](url)\n\n- item\n";
  const input = {bytes: new TextEncoder().encode(text), source: "document.md"}, options = {from: "markdown", to, fileScope};
  const ceiling = 1000000, boundaries = new Set<number>(), original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  for (const budget of ["retainedBytes", "references"] as const) {
    boundaries.clear(); boundaries.add(0); boundaries.add(ceiling);
    const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {const result = original.apply(this, args); if (args[0] === budget) {const used = ceiling - this.remaining(budget); boundaries.add(used); boundaries.add(used - 1);} return result;});
    try {await convert([input], options, {limits: {[budget]: ceiling}, output: sink([])});} finally {trace.mockRestore();}
    const values = [...boundaries];
    for (const limit of values.filter((_, i) => i % Math.ceil(values.length / 24) === 0 || i >= values.length - 4)) {
      if (limit < 0) continue;
      const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [], limits = {[budget]: limit};
      const expected = await convert([input], options, {limits, output: sink(expectedBytes)}).catch(error => error);
      const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
      let actual;
      try {actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error); expect(acquire).not.toHaveBeenCalled();}
      finally {acquire.mockRestore();}
      if (expected instanceof Error) expect(actual, `${budget}=${limit}`).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, `${budget}=${limit}`).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes); expect(await fs.readdir("/")).toEqual([]);
    }
  }
});
it.each(["nodes", "text", "depth", "attributes", "tableCells"] as const)("preserves Markdown %s failures and locations", async budget => {
  const input = {bytes: new TextEncoder().encode("# Heading\n\n| a | b |\n|---|---|\n| x | y |\n"), source: "document.md"};
  for (const limit of [0, 1, 8, 32, 64, 512]) for (const fileScope of [false, true]) {
    const options = {from: "markdown", to: "json", fileScope}, limits = {[budget]: limit};
    const expected = await convert([input], options, {limits}).catch(error => error), fs = new MemoryFileSystem(); let bytes = "";
    const actual = await convertToOutput([input], options, {limits, workingFiles: {fs, directory: "/"}, output: {async write(chunk) {bytes += new TextDecoder().decode(chunk);}, async close() {}, async abort() {}}}).catch(error => error);
    if (expected instanceof Error) expect(actual, `${budget}=${limit}`).toMatchObject({message: expected.message, code: (expected as {code?: string}).code, location: (expected as {location?: string}).location});
    else {expect(actual).not.toBeInstanceOf(Error); expect(bytes).toBe(expected.text);}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
