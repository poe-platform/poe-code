import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfFileSource } from "../source.js";
import { dictGet } from "../ast.js";
import { QpdfJsonDocument } from "./qpdf-json-document.js";

const encoder = new TextEncoder();
async function* json(value: unknown) {
  const bytes = encoder.encode(typeof value === "string" ? value : JSON.stringify(value));
  for (let i = 0; i < bytes.length; i += 13) yield bytes.subarray(i, i + 13);
}
async function read(document: QpdfJsonDocument) {
  const chunks = [];
  for await (const bytes of document.chunks()) chunks.push(bytes);
  return PdfDocument.load(new Uint8Array(Buffer.concat(chunks)));
}
const pages = { "2 0 R": { value: { "/Type": "/Pages", "/Count": 0, "/Kids": [] } } };
const catalog = { value: { "/Type": "/Catalog", "/Pages": "2 0 R" } };

it("imports objects and keeps catalog fallback in insertion order through delete/reinsert updates", async () => {
  const fs = createMemoryFileSystem(),
    document = new QpdfJsonDocument({ fs, directory: "/" });
  try {
    await document.apply(json({ objects: { "4 0 R": catalog, "1 0 R": catalog, ...pages } }));
    expect(document.rootRef).toMatchObject({ objectNumber: 4 });
    await document.apply(json({ qpdf: [{}, { "4 0 R": { value: null } }] }));
    expect(document.rootRef).toMatchObject({ objectNumber: 1 });
    await document.apply(json({ objects: { "4 3 R": catalog, "1 0 R": { value: null } } }));
    expect(document.rootRef).toMatchObject({ objectNumber: 4, generationNumber: 3 });
    const parsed = await read(document);
    expect(parsed.cos.rootRef).toMatchObject({ objectNumber: 4, generationNumber: 3 });
    expect(parsed.cos.objects.has(1)).toBe(false);
  } finally {
    await document.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});

it("streams permissive base64 and retains previous raw bytes when an update omits data", async () => {
  const fs = createMemoryFileSystem(),
    document = new QpdfJsonDocument({ fs, directory: "/" });
  try {
    await document.apply(
      json({
        objects: {
          "1 0 R": catalog,
          ...pages,
          "4 0 R": {
            stream: {
              dict: { "/Filter": "/FlateDecode", "/DecodeParms": {}, "/Length": 100 },
              data: "QU=JD!?RA=="
            }
          }
        }
      })
    );
    let value = (await read(document)).cos.objects.get(4)!.value;
    expect(value.kind).toBe("stream");
    if (value.kind !== "stream") throw Error("stream required");
    expect(value.rawBytes).toEqual(encoder.encode("ABCD"));
    expect(dictGet(value.dict, "Filter")).toBeUndefined();
    expect(dictGet(value.dict, "DecodeParms")).toBeUndefined();
    await document.apply(
      json({ objects: { "4 5 R": { stream: { dict: { "/Label": "u:updated" } } } } })
    );
    value = (await read(document)).cos.objects.get(4)!.value;
    expect(value.kind).toBe("stream");
    if (value.kind !== "stream") throw Error("stream required");
    expect(value.rawBytes).toEqual(encoder.encode("ABCD"));
    expect(dictGet(value.dict, "Length")).toMatchObject({ kind: "number", value: 4 });
  } finally {
    await document.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});

it("uses caller-retained datafiles and preserves explicit root/info references", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", encoder.encode("payload"));
  const file = await PdfFileSource.open(fs, "/data"),
    document = new QpdfJsonDocument({ fs, directory: "/" });
  try {
    await document.apply(
      json({
        objects: {
          "1 0 R": catalog,
          ...pages,
          "3 0 R": { value: { "/Title": "u:retained" } },
          "4 0 R": { stream: { datafile: "data" } },
          trailer: { value: { "/Root": "1 0 R", "/Info": "3 0 R" } }
        }
      }),
      { dataFile: async (path) => (path === "data" ? file : undefined) }
    );
    expect(document.infoRef).toMatchObject({ objectNumber: 3 });
    const value = (await read(document)).cos.objects.get(4)!.value;
    expect(value.kind === "stream" && value.rawBytes).toEqual(encoder.encode("payload"));
    expect(await file.read(0, 7)).toEqual(encoder.encode("payload"));
    await expect(
      document.apply(json({ objects: { "4 0 R": { stream: { datafile: "missing" } } } }))
    ).rejects.toThrow("cannot open stream datafile missing");
  } finally {
    await document.close();
    await file.close();
  }
  expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["data"]);
});

it("validates discarded dictionary values and rejects invalid roots and missing sections", async () => {
  const fs = createMemoryFileSystem(),
    document = new QpdfJsonDocument({ fs, directory: "/" });
  try {
    for (const input of ["null", "false", "1"])
      await expect(document.apply(json(input))).rejects.toThrow("Invalid QPDF JSON root");
    for (const input of ["{}", "[]", '{"qpdf":[{},null],"objects":{}}'])
      await expect(document.apply(json(input))).rejects.toThrow(
        "Missing QPDF JSON objects section"
      );
    await expect(
      document.apply(json('{"objects":{"4 0 R":{"stream":{"dict":{"/Length":1e400},"data":""}}}}'))
    ).rejects.toThrow("Invalid non-finite PDF number");
    await expect(
      document.apply(json('{"objects":{"4 0 R":{"stream":{"dict":[1e400],"data":""}}}}'))
    ).rejects.toThrow("Invalid non-finite PDF number");
    await expect(document.apply(json("{"))).rejects.toBeInstanceOf(SyntaxError);
  } finally {
    await document.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});

it("copies a retained PDF and reuses stream snapshots during JSON updates", async () => {
  const { PdfRetainedDocument } = await import("../retained-document.js");
  const fs = createMemoryFileSystem(),
    storage = { fs, directory: "/" };
  const original = new QpdfJsonDocument(storage);
  let source: PdfFileSource | undefined,
    retained: Awaited<ReturnType<typeof PdfRetainedDocument.open>> | undefined,
    updated: QpdfJsonDocument | undefined;
  try {
    await original.apply(
      json({
        objects: { "4 0 R": catalog, ...pages, "7 0 R": { stream: { dict: {}, data: "AQID" } } }
      })
    );
    source = await PdfFileSource.fromStream(fs, "/", original.chunks());
    retained = await PdfRetainedDocument.open(source, storage);
    updated = await QpdfJsonDocument.fromDocument(retained, source, storage);
    await updated.apply(
      json({ objects: { "7 2 R": { stream: { dict: { "/Label": "u:changed" } } } } })
    );
    const value = (await read(updated)).cos.objects.get(7)!;
    expect(value.generationNumber).toBe(2);
    expect(value.value.kind === "stream" && value.value.rawBytes).toEqual(Uint8Array.of(1, 2, 3));
    expect((await retained.objects.get(7))!.generationNumber).toBe(0);
  } finally {
    await updated?.close();
    await retained?.close();
    await source?.close();
    await original.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});

it("consumes generated base64 through injected storage without whole-file I/O", async () => {
  const base = createMemoryFileSystem();
  let writes = 0,
    peak = 0;
  const fs = new Proxy(base, {
    get(target, key) {
      if (key === "readFile" || key === "writeFile")
        return () => {
          throw Error("whole-file I/O forbidden");
        };
      if (key === "open")
        return async (...args: Parameters<NonNullable<typeof base.open>>) => {
          const handle = await target.open!(...args);
          return new Proxy(handle, {
            get(owner, field) {
              if (field === "write")
                return async (...args: Parameters<typeof handle.write>) => {
                  writes++;
                  peak = Math.max(peak, args[0].buffer.byteLength);
                  await Promise.resolve();
                  return owner.write(...args);
                };
              const value = Reflect.get(owner, field);
              return typeof value === "function" ? value.bind(owner) : value;
            }
          });
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const document = new QpdfJsonDocument({ fs, directory: "/" });
  const count = 96;
  try {
    await document.apply(
      (async function* () {
        yield encoder.encode(
          '{"objects":{"1 0 R":{"value":{"/Type":"/Catalog","/Pages":"2 0 R"}},"2 0 R":{"value":{"/Type":"/Pages","/Count":0,"/Kids":[]}},"4 0 R":{"stream":{"data":"'
        );
        const bytes = encoder.encode("AAAA".repeat(1024));
        for (let i = 0; i < count; i++) yield bytes;
        yield encoder.encode('"}}}}');
      })()
    );
    let zeros = 0;
    for await (const chunk of document.chunks({ chunkBytes: 8192 })) {
      expect(chunk.buffer.byteLength).toBeLessThanOrEqual(8192);
      for (const byte of chunk) if (byte === 0) zeros++;
      await Promise.resolve();
    }
    expect(zeros).toBe(count * 3072);
    expect(writes).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(16384);
  } finally {
    await document.close();
  }
  expect(await base.readdir("/")).toEqual([]);
});

it("enforces input admission and cancellation with cleanup", async () => {
  const fs = createMemoryFileSystem(),
    controller = new AbortController(),
    reason = new Error("cancel JSON import");
  const document = new QpdfJsonDocument({ fs, directory: "/" }, { signal: controller.signal });
  let closed = false;
  try {
    await expect(document.apply(json("{}"), { maxInputBytes: 1 })).rejects.toThrow(
      "input byte limit"
    );
    await expect(
      document.apply(
        (async function* () {
          try {
            yield encoder.encode('{"objects":');
            controller.abort(reason);
            yield encoder.encode("{} }");
          } finally {
            closed = true;
          }
        })()
      )
    ).rejects.toBe(reason);
    expect(closed).toBe(true);
  } finally {
    await document.close();
  }
  expect(await fs.readdir("/")).toEqual([]);
});

it("validates dictionary values before resolving stream datafiles", async () => {
  const fs = createMemoryFileSystem(),
    document = new QpdfJsonDocument({ fs, directory: "/" });
  let opened = false;
  try {
    await expect(
      document.apply(
        json('{"objects":{"4 0 R":{"stream":{"dict":{"/Length":1e400},"datafile":"missing"}}}}'),
        {
          dataFile: async () => {
            opened = true;
            return undefined;
          }
        }
      )
    ).rejects.toThrow("Invalid non-finite PDF number");
    expect(opened).toBe(false);
  } finally {
    await document.close();
  }
});
