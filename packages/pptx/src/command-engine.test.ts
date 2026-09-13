import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { compileJsonSchema } from "toolcraft-schema";
import { storedArchive } from "../tests/fixtures/archive.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readSelectionIndex } from "./selectors.js";
import { OfficeError } from "./errors.js";
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 30,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 30, maxRelationships: 30 }
};
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const rels = (rows: string) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`;
const bytes = storedArchive([
  {
    name: "_rels/.rels",
    bytes: encode(
      rels(`<Relationship Id="document" Type="${r}/officeDocument" Target="deck.xml"/>`)
    )
  },
  {
    name: "deck.xml",
    bytes: encode(
      `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="512" r:id="page"/></p:sldIdLst></p:presentation>`
    )
  },
  {
    name: "_rels/deck.xml.rels",
    bytes: encode(rels(`<Relationship Id="page" Type="${r}/slide" Target="page.xml"/>`))
  },
  {
    name: "page.xml",
    bytes: encode(
      `<p:sld xmlns:p="${p}"><p:cSld name="River"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="7"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>`
    )
  }
]);
function request(
  args: string[],
  readInput = vi.fn(async (_path: string, _maximum: number) => bytes)
) {
  return { args: args.map(encode), signal: new AbortController().signal, readInput };
}
const options = { context, maxArgumentBytes: 65536, maxOutputBytes: 65536 };

describe("presentation command engine", () => {
  it("runs byte arguments through a supplied memfs capability with SDK selector parity", async () => {
    const volume = Volume.fromJSON({ "/river.pptx": Buffer.from(bytes) });
    const readInput = vi.fn(async (path: string, maximum: number) => {
      expect(maximum).toBe(65536);
      return new Uint8Array(volume.readFileSync(path) as Buffer);
    });
    const engine = createPptxCommandEngine(options);
    const output = await engine.execute(
      request(["inspect", "/river.pptx", "--slide", "1", "--shape", "7", "--json"], readInput)
    );
    expect(output.exitCode).toBe(0);
    expect(output.stderr).toEqual(new Uint8Array());
    const result = JSON.parse(decode(output.stdout));
    expect(result.data.records.map((record: { id: string }) => record.id)).toEqual(["4"]);
    const index = await readSelectionIndex(bytes, context);
    expect(result.data.records).toEqual(
      index.select({ kind: "object", owner: "/page.xml", name: "7" })
    );
    expect(readInput).toHaveBeenCalledWith("/river.pptx", 65536);
    expect(volume.readFileSync("/river.pptx")).toEqual(Buffer.from(bytes));
  });
  it("validates UTF-8, selector syntax and malformed tokens before opening input", async () => {
    const engine = createPptxCommandEngine(options);
    for (const args of [
      ["inspect", "missing", "--select", "broken", "--json"],
      ["inspect", "missing", "--slide", "0", "--json"],
      ["inspect", "missing", "--json", "--json"]
    ]) {
      const invocation = request(args);
      const output = await engine.execute(invocation);
      expect(output.exitCode).toBe(2);
      expect(JSON.parse(decode(output.stdout)).ok).toBe(false);
      expect(invocation.readInput).not.toHaveBeenCalled();
    }
    const invocation = request(["inspect", "missing"]);
    const output = await engine.execute({
      ...invocation,
      args: [encode("inspect"), Uint8Array.of(255)]
    });
    expect(output.exitCode).toBe(2);
    expect(decode(output.stderr)).toContain("Arguments must be UTF-8");
    expect(invocation.readInput).not.toHaveBeenCalled();
  });
  it("rejects invalid part URIs before using the read capability", async () => {
    const engine = createPptxCommandEngine(options);
    const invocation = request(["inspect", "absent", "--part", "/../escape.xml", "--json"]);
    const output = await engine.execute(invocation);
    expect(output.exitCode).toBe(2);
    expect(JSON.parse(decode(output.stdout)).errors[0].code).toBe("invalid-selection");
    expect(invocation.readInput).not.toHaveBeenCalled();
  });
  it("preserves leading byte-order-mark characters in literal argument values", async () => {
    const engine = createPptxCommandEngine(options);
    const invocation = request(["inspect", "\ufeffriver.pptx", "--json"]);
    expect((await engine.execute(invocation)).exitCode).toBe(0);
    expect(invocation.readInput).toHaveBeenCalledWith("\ufeffriver.pptx", 65536);
  });
  it("passes the smaller archive admission cap to the read capability", async () => {
    const engine = createPptxCommandEngine({
      ...options,
      context: { ...context, archiveLimits: { ...context.archiveLimits, maxArchiveBytes: 32768 } }
    });
    const invocation = request(["inspect", "-", "--json"]);
    expect((await engine.execute(invocation)).exitCode).toBe(0);
    expect(invocation.readInput).toHaveBeenCalledWith("-", 32768);
  });
  it("returns real schema and explicit capabilities without invoking I/O", async () => {
    const engine = createPptxCommandEngine(options);
    const invocation = request(["schema", "inspect", "--json"]);
    const schema = JSON.parse(decode((await engine.execute(invocation)).stdout)).data.operations
      .inspect;
    const result = JSON.parse(
      decode((await engine.execute(request(["inspect", "-", "--json"]))).stdout)
    );
    expect(compileJsonSchema(schema.result).validate(result).ok).toBe(true);
    expect(compileJsonSchema(schema.options).validate({ slide: 0 }).ok).toBe(false);
    expect(invocation.readInput).not.toHaveBeenCalled();
    const capabilities = JSON.parse(
      decode((await engine.execute(request(["capabilities", "--json"]))).stdout)
    );
    expect(capabilities.data.features.editing.level).toBe("reject");
  });
  it("classifies explicit I/O failures and never exposes unknown exception messages", async () => {
    const engine = createPptxCommandEngine(options);
    for (const [error, status, code] of [
      [new Error("private path"), 3, "io-failure"],
      [new OfficeError("io-failure", "Input read failed.", "admit"), 3, "io-failure"],
      [new OfficeError("resource-limit", "bounded", "admit"), 4, "resource-limit"]
    ] as const) {
      const invocation = request(
        ["inspect", "-", "--json"],
        vi.fn(async () => {
          throw error;
        })
      );
      const output = await engine.execute(invocation);
      expect(output.exitCode).toBe(status);
      expect(JSON.parse(decode(output.stdout)).errors[0].code).toBe(code);
      expect(decode(output.stdout)).not.toContain("private path");
    }
  });
  it("observes cancellation after a supplied asynchronous read", async () => {
    const controller = new AbortController();
    const engine = createPptxCommandEngine(options);
    const output = await engine.execute({
      args: [encode("inspect"), encode("-")],
      signal: controller.signal,
      async readInput() {
        controller.abort();
        return bytes;
      }
    });
    expect(output).toEqual({ exitCode: 130, stdout: new Uint8Array(), stderr: new Uint8Array() });
  });
  it("maps neutral capability limit failures without coupling to a filesystem class", async () => {
    const engine = createPptxCommandEngine(options);
    const output = await engine.execute(
      request(
        ["inspect", "-", "--json"],
        vi.fn(async () => {
          throw Object.assign(new Error("private"), { code: "resource-limit" });
        })
      )
    );
    expect(output.exitCode).toBe(4);
    expect(JSON.parse(decode(output.stdout)).errors[0].code).toBe("resource-limit");
    expect(decode(output.stdout)).not.toContain("private");
  });
  it("rejects non-byte arguments and stops JSON hint scanning at the argument bound", async () => {
    const engine = createPptxCommandEngine({ ...options, maxArgumentBytes: 20 });
    const invocation = request(["inspect", "missing"]);
    const wrongType = await engine.execute({ ...invocation, args: ["--json"] as never });
    expect(wrongType.exitCode).toBe(2);
    const argumentsWithOversizedPrefix = [encode("inspect"), encode("x".repeat(30))];
    Object.defineProperty(argumentsWithOversizedPrefix, 2, {
      get() {
        throw new Error("unbounded argument access");
      }
    });
    const limited = await engine.execute({ ...invocation, args: argumentsWithOversizedPrefix });
    expect(limited.exitCode).toBe(4);
    expect(invocation.readInput).not.toHaveBeenCalled();
  });
  it("bounds output and argument bytes and observes cancellation before I/O", async () => {
    const engine = createPptxCommandEngine({
      ...options,
      maxOutputBytes: 512,
      maxArgumentBytes: 100
    });
    const output = await engine.execute(request(["schema", "--json"]));
    expect(output.exitCode).toBe(4);
    expect(output.stdout.length).toBeLessThanOrEqual(512);
    expect(JSON.parse(decode(output.stdout)).errors[0].code).toBe("resource-limit");
    const tooLong = await engine.execute(request(["inspect", "x".repeat(101), "--json"]));
    expect(tooLong.exitCode).toBe(4);
    const invocation = request(["inspect", "-"]);
    const controller = new AbortController();
    controller.abort();
    expect(await engine.execute({ ...invocation, signal: controller.signal })).toEqual({
      exitCode: 130,
      stdout: new Uint8Array(),
      stderr: new Uint8Array()
    });
    expect(invocation.readInput).not.toHaveBeenCalled();
  });
});
