import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {ExecutionContext} from "./execution.js";
import {parseRtf, type RtfToken} from "./rtf-syntax.js";
import {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
const encode = (text: string) => new TextEncoder().encode(text);
async function materialize(syntax: RetainedRtfSyntax, node: number): Promise<RtfToken> {
  const token = await syntax.token(node), offset = token.offset;
  if (token.kind === "group") {
    const children: RtfToken[] = [];
    for await (const child of syntax.children(node)) children.push(await materialize(syntax, child));
    return {kind: "group", offset, children};
  }
  if (token.kind === "text" || token.kind === "binary") {
    const chunks: Uint8Array[] = []; for await (const bytes of syntax.chunks(node)) chunks.push(bytes);
    return {kind: token.kind, offset, bytes: Uint8Array.from(chunks.flatMap(bytes => [...bytes]))};
  }
  if (token.kind === "hex") return {kind: "hex", offset, byte: token.byte};
  if (token.kind === "symbol") return {kind: "symbol", offset, name: token.name};
  return {kind: "word", offset, name: token.name, parameter: token.parameter};
}
it.each([
  "{\\rtf1}", "{\\rtf1\\ansi Hello {\\b bold} world\\par}", "\r\n{\\rtf1\r\n text\r\n}\n",
  "{\\rtf1\\u-32768?\\uc0\\u32767\\foo2147483647\\bar-2147483648\\zero-0}",
  "{\\rtf1\\'80\\'ff\\'A0\\{\\}\\\\\\~\\_\\-\\\n}",
  "{\\rtf1{\\*\\unknown \\bin5 {\\}xx}tail}", "{\\rtf1\\bin0 text}"
])("retains RTF structure and raw payloads: %s", async text => {
  const input = encode(text), context = new ExecutionContext("convert", {}), fs = new MemoryFileSystem();
  try {
    const expected = await parseRtf(input, context);
    const syntax = await RetainedRtfSyntax.acquire({chunks: (async function* () {const byte = new Uint8Array(1); for (const value of input) {byte[0] = value; yield byte;}})()}, context, {fs, directory: "/", cacheBytes: 16384});
    try {expect(await materialize(syntax, syntax.root)).toEqual(expected);} finally {await syntax.close();}
  } finally {await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it.each(["", "text", "{}", "{\\rtf2}", "{\\RTF1}", "{\\rtf1}{\\rtf1}", "{\\rtf1", "}", "{\\rtf1\\", "{\\rtf1\\'x0}", "{\\rtf1\\'a}", "{\\rtf1\\foo-}", "{\\rtf1\\foo2147483648}", "{\\rtf1\\foo-2147483649}", "{\\rtf1\\bin}", "{\\rtf1\\bin-1}", "{\\rtf1\\bin10 abc}", "{\\rtf1\\" + "x".repeat(33) + "}"])("preserves RTF syntax errors: %s", async text => {
  const input = {bytes: encode(text)}, context = new ExecutionContext("convert", {}), fs = new MemoryFileSystem();
  try {
    const expected = await parseRtf(input.bytes, context).catch(error => error);
    expect(expected).toBeInstanceOf(Error);
    await expect(RetainedRtfSyntax.acquire(input, context, {fs, directory: "/", cacheBytes: 16384})).rejects.toMatchObject({code: expected.code, operation: expected.operation, message: expected.message, location: expected.location});
  } finally {await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it("retains long byte runs and deep groups without whole-file reads", async () => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  const source = encode("{\\rtf1 " + "{".repeat(1024) + "x".repeat(131073) + "}".repeat(1025));
  try {
    const syntax = await RetainedRtfSyntax.acquire({bytes: source}, context, {fs, directory: "/", cacheBytes: 16384});
    let node = syntax.root;
    for (let depth = 0; depth < 1024; depth++) {
      const children: number[] = []; for await (const child of syntax.children(node)) children.push(child);
      node = children.at(-1)!;
    }
    const child = await syntax.children(node).next();
    let length = 0; for await (const bytes of syntax.chunks(child.value!)) {expect(bytes.length).toBeLessThanOrEqual(16384); expect(bytes.every(byte => byte === 120)).toBe(true); length += bytes.length;}
    expect(length).toBe(131073); await syntax.close();
  } finally {await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it.each(["source", "cancel", "storage", "tokens"])("retires RTF input and token storage on %s failure", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), context = new ExecutionContext("convert", {signal: controller.signal}), open = fs.open.bind(fs);
  let finalized = false, live = 0, opened = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle); live++; opened++;
    if (mode === "storage" || mode === "tokens" && opened === 2) vi.spyOn(handle, "write").mockRejectedValue(new Error("Storage failed"));
    vi.spyOn(handle, "close").mockImplementation(async () => {try {await close();} finally {live--;}}); return handle;
  });
  const chunks = (async function* () {try {yield encode("{\\rtf1 " + ("x".repeat(65536) + (mode === "tokens" ? "{x}".repeat(1024) : ""))); if (mode === "source") throw new Error("Source failed"); if (mode === "cancel") controller.abort(); yield encode("}");} finally {finalized = true;}})();
  try {await expect(RetainedRtfSyntax.acquire({chunks}, context, {fs, directory: "/", cacheBytes: 16384})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});}
  finally {await context.close(); expect(finalized).toBe(true); expect(live).toBe(0); expect(await fs.readdir("/")).toEqual([]);}
});

it("keeps binary bytes opaque and bounded across source/cache boundaries", async () => {
  const payload = Uint8Array.from({length: 65537}, (_, index) => index & 255), prefix = encode("{\\rtf1\\bin65537 ");
  const bytes = new Uint8Array(prefix.length + payload.length + 1); bytes.set(prefix); bytes.set(payload, prefix.length); bytes[bytes.length - 1] = 125;
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  try {
    const syntax = await RetainedRtfSyntax.acquire({chunks: (async function* () {for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7);})()}, context, {fs, directory: "/", cacheBytes: 16384});
    let consumed = 0;
    for await (const child of syntax.children(syntax.root)) if ((await syntax.token(child)).kind === "binary") {
      for await (const chunk of syntax.chunks(child)) {expect(chunk.length).toBeLessThanOrEqual(16384); expect(chunk).toEqual(payload.subarray(consumed, consumed + chunk.length)); consumed += chunk.length;}
    }
    expect(consumed).toBe(payload.length); await syntax.close();
  } finally {await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
it("preserves group depth and binary budgets without a resident parse tree", async () => {
  for (const limits of [{depth: 2}, {binaryBytes: 2}]) {
    const bytes = encode("{\\rtf1{{\\bin3 abc}}}"), fs = new MemoryFileSystem(), buffered = new ExecutionContext("convert", {limits}), retained = new ExecutionContext("convert", {limits});
    try {
      const expected = await parseRtf(bytes, buffered).catch(error => error);
      expect(expected).toMatchObject({code: "E_LIMIT"});
      await expect(RetainedRtfSyntax.acquire({bytes}, retained, {fs, directory: "/", cacheBytes: 16384})).rejects.toMatchObject({code: expected.code, message: expected.message});
    } finally {await buffered.close(); await retained.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
