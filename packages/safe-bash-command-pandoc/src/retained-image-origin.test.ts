import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convertToOutput} from "./engine.js";
import {createJsonFilterCapability} from "./json-filters.js";

it.each(["data:", "custom:", "custom: ", "relative-", "https://example.test/", "custom://example.test/?", "file:/", "file://example.test/"])("does not materialize long JSON-filter image admission for %s", async prefix => {
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

it.each(["https", "custom"])("does not retain long %s credentials for origin admission", async scheme => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {}), value = scheme + "://" + "user:password@".repeat(2000) + "example.test/path";
  const native = URL.canParse.bind(URL), parse = vi.spyOn(URL, "canParse").mockImplementation((value, base) => {
    if (String(value).length > 64) throw new Error("Whole credentials forbidden");
    return native(value, base);
  });
  try {expect(await retainedImageOriginAllowed(async function* () {for (let i = 0; i < value.length; i += 64) yield value.slice(i, i + 64);}, context)).toBe(true);}
  finally {parse.mockRestore(); await context.close();}
});

it("matches authority parsing for credentials, ports, IPv6 and malformed delimiters", async () => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {});
  const authorities = ["", "user@", "@host", "a:b:c@host", "user@user@host", "[::1]", "[::1]:65535", "[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]", "[::1]:65536", "host:", "host:bad", "host:00080", "host:0x80", "host\0", "host ", "[bad]", "host%2f", "xn--bcher-kva.test", "bücher.test", "0xffffffff", "1.2.3.999", "127.1", "a\\b", "@", "[x]@host", "C|", "C|é", "C|%30", "C:", "C|a"];
  let seed = 1770;
  const tokens = ["@", ":", " ", "\t", "\r", "\0", "[", "]", "80", "a", "%00", "%2f", "\\", "/", "?", "#"];
  for (let i = 0; i < 1000; i++) {
    let value = "";
    for (let j = 0; j < 8; j++) {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += tokens[(seed >>> 16) % tokens.length];}
    authorities.push(value);
  }
  try {
    for (const scheme of ["http", "https", "ftp", "ws", "wss", "custom", "file"]) for (const host of authorities) for (const suffix of ["", "/path", "?q", "#fragment"]) {
      const value = scheme + "://" + host + suffix;
      expect(await retainedImageOriginAllowed(async function* () {for (let i = 0; i < value.length; i += 3) yield value.slice(i, i + 3);}, context), JSON.stringify(value)).toBe(URL.canParse(value));
    }
  } finally {await context.close();}
});

it("validates long ports without retaining their digits", async () => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {}), native = URL.canParse.bind(URL);
  const parse = vi.spyOn(URL, "canParse").mockImplementation((value, base) => {
    if (String(value).length > 128) throw new Error("Whole port forbidden");
    return native(value, base);
  });
  try {
    for (const scheme of ["http", "custom", "file"]) for (const host of ["example.test", "[::1]", "C"]) for (const tail of ["80", "65535", "65536", "", "9".repeat(10000), "80 \0", "80 \0/path"]) {
      const value = `${scheme}://${host}:` + "0".repeat(10000) + tail;
      expect(await retainedImageOriginAllowed(async function* () {for (let i = 0; i < value.length; i += 1000) yield value.slice(i, i + 1000);}, context), `${scheme} ${host} ${tail.slice(0,20)}`).toBe(native(value));
    }
  } finally {parse.mockRestore(); await context.close();}
});

it("validates opaque hosts and rejects oversized IPv6 without retaining host payloads", async () => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {}), native = URL.canParse.bind(URL);
  const values = ["custom://" + "é".repeat(20000), "custom://" + "a".repeat(20000) + "%bad", "custom://" + "a".repeat(20000) + "^", "https://[" + "0".repeat(20000) + "]", "custom://[" + "0".repeat(20000) + "]"];
  const parse = vi.spyOn(URL, "canParse").mockImplementation((value, base) => {
    if (String(value).length > 128) throw new Error("Whole host forbidden");
    return native(value, base);
  });
  try {
    for (const value of values) expect(await retainedImageOriginAllowed(async function* () {for (let i = 0; i < value.length; i += 128) yield value.slice(i, i + 128);}, context)).toBe(native(value));
  } finally {parse.mockRestore(); await context.close();}
});

it("validates long ASCII domains and IPv4 numbers without resident host strings", async () => {
  const {retainedImageOriginAllowed} = await import("./retained-image-origin.js");
  const {ExecutionContext} = await import("./execution.js");
  const context = new ExecutionContext("convert", {}), native = URL.canParse.bind(URL);
  const hosts = ["_".repeat(20000), "x".repeat(20000) + "^", "x".repeat(20000), "a.".repeat(10000) + "test", "0".repeat(20000), "0".repeat(20000) + "9", "0x" + "0".repeat(20000) + "ffffffff", "1.2.3." + "0".repeat(20000) + "7"];
  const parse = vi.spyOn(URL, "canParse").mockImplementation((value, base) => {
    if (String(value).length > 128) throw new Error("Whole domain forbidden");
    return native(value, base);
  });
  try {
    for (const host of hosts) for (const scheme of ["http", "file"]) {
      const value = `${scheme}://${host}/path`;
      expect(await retainedImageOriginAllowed(async function* () {for (let i = 0; i < value.length; i += 128) yield value.slice(i, i + 128);}, context)).toBe(native(value));
    }
  } finally {parse.mockRestore(); await context.close();}
});
