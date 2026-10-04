import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convertToOutput} from "./engine.js";
import {createJsonFilterCapability} from "./json-filters.js";

it.each(["data:", "custom:", "custom: ", "relative-"])("does not materialize long JSON-filter image admission for %s", async prefix => {
  const url = prefix + "x".repeat(20000), fs = new MemoryFileSystem();
  const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta: {}, blocks: [{t: "Para", c: [{t: "Image", c: [["", [], []], [], [url, ""]]}]}]}))};
  const options = {from: "json", to: "json", filters: [{kind: "json" as const, path: "/filter"}]};
  const filters = createJsonFilterCapability({async runStream({stdin, stdout}) {for await (const chunk of stdin) await stdout.write(chunk); return 0;}});
  const native = URL.canParse.bind(URL), parse = vi.spyOn(URL, "canParse").mockImplementation((value, base) => {
    if (String(value).length > 4096) throw new Error("Whole URI forbidden");
    return native(value, base);
  });
  try {
    const result = await convertToOutput([input], options, {filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}}).catch(error => error);
    if (prefix.startsWith("relative")) expect(result).toMatchObject({code: "E_UNSUPPORTED_FEATURE", message: "JSON filters cannot preserve relative image source directories"});
    else expect(result).not.toBeInstanceOf(Error);
  } finally {parse.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("matches native URL admission across preprocessing, schemes, authorities and chunk boundaries", async () => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {});
  const prefixes = ["", "/", "//", "a:", "custom:", "data:", "mailto:", "http:", "HTTPS:", "file:", "ftp:", "ws:", "wss:", "a+b.c-d:", "1:", "a :", "httpsx:", "ht\ttp:", "\0 a:"];
  const endings = ["", "/", "//", "///", "//[", "//[::1]", "//bad host", "//x:bad", "/x", "?", "#", "\\", " ", "\0", "\t\r\n", "😀", "%zz", "//é.test/x", "x".repeat(5000)];
  try {
    for (const prefix of prefixes) for (const ending of endings) for (const leading of ["", " \r\n"]) {
      const value = leading + prefix + ending;
      const expected = value.startsWith("/") || URL.canParse(value);
      for (const size of [1, 7, 4096]) {
        const chunks = async function* () {for (let i = 0; i < value.length; i += size) yield value.slice(i, i + size);};
        expect(await retainedImageOriginAllowed(chunks, context), JSON.stringify(value)).toBe(expected);
      }
    }
  } finally {await context.close();}
});

it("charges all URI chunks before accepting or rejecting and preserves cancellation", async () => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  for (const prefix of ["/", "data:", "relative", "http://x/"]) {
    const context = new ExecutionContext("convert", {limits: {retainedBytes: 100}});
    try {
      await expect(retainedImageOriginAllowed(async function* () {yield prefix; yield "x".repeat(100);}, context)).rejects.toMatchObject({code: "E_LIMIT", message: `retainedBytes: ${prefix.length * 2 + 200} exceeds 100`});
    } finally {await context.close();}
  }
  const controller = new AbortController(), context = new ExecutionContext("convert", {signal: controller.signal});
  try {
    await expect(retainedImageOriginAllowed(async function* () {yield "data:"; controller.abort(); yield "payload";}, context)).rejects.toMatchObject({code: "E_CANCELLED"});
  } finally {await context.close();}
});
