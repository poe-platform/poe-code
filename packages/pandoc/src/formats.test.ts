import { describe, expect, it, vi } from "vitest";
import { createFormatRegistry, coreFormats, readDocument, writeDocument } from "./index.js";
import type { Document, ReaderCapability } from "./index.js";
const document: Document = { blocks: [], metadata: {}, resources: [] };

describe("declarative format registry", () => {
  it("resolves directional aliases and rejects deferred/case-sensitive names", () => {
    const registry = createFormatRegistry(coreFormats);
    expect(registry.parse("html", "write").descriptor.name).toBe("html5");
    expect(registry.capabilities.find((item) => item.name === "html")?.write.allowed).toBe(true);
    expect(registry.parse("html", "read").descriptor.name).toBe("html");
    for (const name of ["markdown", "HTML", "unknown", "html5"])
      expect(() => registry.parse(name, "read")).toThrowError(
        expect.objectContaining({ code: "E_FORMAT" })
      );
  });
  it("scans toggles left to right and keeps disabled extensions explicit", () => {
    const registry = createFormatRegistry(coreFormats);
    expect(
      registry.parse("gfm-pipe_tables+pipe_tables-strikeout-strikeout", "read").extensions
    ).toEqual({ autolink_bare_uris: true, pipe_tables: true, raw_html: true, strikeout: false, task_lists: true });
    for (const name of ["gfm+", "gfm--strikeout", "gfm+unknown", "commonmark+pipe_tables"])
      expect(() => registry.parse(name, "read")).toThrowError(
        expect.objectContaining({ code: "E_EXTENSION" })
      );
    expect(() => registry.parse("unknown+pipe_tables", "read")).toThrowError(
      expect.objectContaining({ code: "E_FORMAT" })
    );
  });
  it("rejects name/alias collisions in each direction but permits directional aliases", () => {
    const format = coreFormats.find((item) => item.name === "commonmark")!;
    for (const duplicate of [format, { ...format, name: "new", aliases: { read: ["commonmark"] } }])
      expect(() => createFormatRegistry([...coreFormats, duplicate])).toThrowError();
  });
  it("derives deterministic lists and suffixes, without advertising absent Office directions", () => {
    const read = vi.fn(async () => document);
    const registry = createFormatRegistry([...coreFormats].reverse(), {
      reader: { format: "docx", read }
    });
    expect(registry.list("read")).toEqual(["commonmark", "csv", "docx", "epub", "gfm", "html", "json", "latex", "rst", "rtf", "tsv"]);
    expect(registry.list("write")).toEqual(["commonmark", "epub", "epub3", "gfm", "html", "html5", "json", "latex", "plain", "rst", "rtf"]);
    expect(registry.infer("file.md", "read")).toBe("commonmark");
    expect(registry.infer("file.html", "write")).toBe("html5");
    expect(() => registry.infer("file.txt", "read")).toThrowError();
    expect(registry.listExtensions("gfm")).toEqual([
      "+autolink_bare_uris",
      "+pipe_tables",
      "+raw_html",
      "+strikeout",
      "+task_lists"
    ]);
    expect(() => registry.parse("xlsx", "write")).toThrowError();
  });
  it("dispatches injected capabilities with canonical selections and toggles", async () => {
    const read = vi.fn<ReaderCapability["read"]>(async () => document);
    await readDocument(
      { bytes: new Uint8Array() },
      { from: "gfm-task_lists" },
      { reader: { format: "gfm", read } }
    );
    expect(read.mock.calls[0]?.[2]).toMatchObject({ extensions: { task_lists: false } });
    const write = vi.fn(async () => ({ kind: "text" as const, text: "" }));
    await writeDocument(document, { to: "html" }, { writer: { format: "html5", write } });
    expect(write).toHaveBeenCalledOnce();
  });
  it("new modules drive lookup, inference, validation and availability together", () => {
    const format = coreFormats.find((item) => item.name === "commonmark")!;
    const registry = createFormatRegistry([
      {
        ...format,
        name: "custom",
        writer: {format: "custom", write: async () => ({kind: "text", text: ""})},
        suffixes: ["custom"],
        reader: { format: "custom", read: async () => document }
      }
    ]);
    expect(registry.list("read")).toEqual(["custom"]);
    expect(registry.infer("a.custom", "read")).toBe("custom");
    expect(registry.resolve("custom", "read").reader).toBeDefined();
    expect(() => registry.validateOptions("custom", "write", ["standalone"])).toThrowError();
  });
  it("does not infer extensionless names or directory suffixes", () => {
    const registry = createFormatRegistry();
    for (const path of ["md", "folder.md/file", "file."])
      expect(() => registry.infer(path, "read")).toThrowError(
        expect.objectContaining({ code: "E_FORMAT" })
      );
  });
  it("inspects output-only extension sets and rejects invalid descriptor bindings", () => {
    expect(createFormatRegistry().listExtensions("pdf")).toEqual([]);
    const descriptor = coreFormats.find((item) => item.name === "commonmark")!;
    expect(() =>
      createFormatRegistry([
        { ...descriptor, reader: { format: "docx", read: async () => document } }
      ])
    ).toThrowError();
  });
});
