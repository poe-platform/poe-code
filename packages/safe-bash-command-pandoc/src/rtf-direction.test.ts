import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

for (const retained of [false, true]) {
  async function read(source: string): Promise<string> {
    const input = {bytes: new TextEncoder().encode(source)}, options = {from: "rtf", to: "plain"};
    if (!retained) {
      const result = await convert([input], options, {});
      if (result.kind !== "text") throw new Error("Expected plain text");
      return result.text;
    }
    const fs = new MemoryFileSystem(); let text = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
    try {
      await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
      }});
      return text;
    } finally {
      const calls = acquire.mock.calls.length; acquire.mockRestore(); expect(calls).toBe(0);
      expect(await fs.readdir("/")).toEqual([]);
    }
  }
  it(`${retained ? "retained" : "collected"} reader accepts ordinary writer output with explicit default paragraph direction`, async () => {
    const written = await convert([{bytes: new TextEncoder().encode("ordinary")}], {from: "commonmark", to: "rtf"}, {});
    if (written.kind !== "text") throw new Error("Expected RTF text");
    expect(written.text).toContain("\\ltrpar");
    expect(await read(written.text)).toBe("ordinary\n");
  });
  it(`${retained ? "retained" : "collected"} reader keeps unsupported direction changes strict`, async () => {
    for (const source of [String.raw`{\rtf1\rtlpar text}`, String.raw`{\rtf1\ltrpar{\rtlpar text}}`,
      String.raw`{\rtf1\rtlch text}`, String.raw`{\rtf1\ltrpar\unknown text}`]) {
      await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
    }
  });
}
