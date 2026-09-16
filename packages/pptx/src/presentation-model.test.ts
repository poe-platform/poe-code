import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { Presentation } from "./presentation-model.js";
import { Inches } from "./length.js";
import { CoreProperties } from "./properties.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

it("creates asynchronously with deterministic original defaults and synchronous live properties", async () => {
  const pending = Presentation();
  expect(pending).toBeInstanceOf(Promise);
  const deck = await pending;
  expect(deck.core_properties).toBeInstanceOf(CoreProperties);
  expect(deck.core_properties).toBe(deck.core_properties);
  expect(deck.core_properties.author).toBe("");
  expect(deck.core_properties.created).toBeNull();
  expect(deck.slide_width?.inches).toBe(10);
  deck.slide_width = new Inches(12);
  deck.slide_height = new Inches(8);
  deck.core_properties.title = "Harbor survey";
  const saved = deck.save();
  expect(saved).toBeInstanceOf(Promise);
  const reopened = await Presentation(await saved);
  expect(reopened.slide_width?.inches).toBe(12);
  expect(reopened.slide_height?.inches).toBe(8);
  expect(reopened.core_properties.title).toBe("Harbor survey");
  expect(await (await Presentation()).save()).toEqual(await (await Presentation()).save());
});

it("owns admitted and returned bytes and snapshots explicit context values", async () => {
  const timestamp = new Date("2024-01-02T03:04:05Z");
  const pending = Presentation(undefined, { timestamp, author: "Field team" });
  timestamp.setUTCFullYear(2030);
  const original = await (await pending).save();
  const loading = Presentation(original);
  original.fill(0);
  const deck = await loading;
  expect(deck.core_properties.author).toBe("Field team");
  expect(deck.core_properties.created?.toISOString()).toBe("2024-01-02T03:04:05.000Z");
  const output = await deck.save();
  output.fill(0);
  expect((await (await Presentation(await deck.save())).save()).byteLength).toBeGreaterThan(0);
});

it("admits only explicit VFS and stream capabilities", async () => {
  const source = await (await Presentation()).save();
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", source);
  const openRead = vi.fn(async () => {
    let read = false;
    return {
      read: async () =>
        read ? null : ((read = true), new Uint8Array(volume.readFileSync("/deck") as Buffer))
    };
  });
  const deck = await Presentation({ path: "/deck", capability: { openRead } });
  expect(openRead).toHaveBeenCalledOnce();
  expect(deck.slide_width?.inches).toBe(10);
  await expect(Presentation("/deck" as never)).rejects.toMatchObject({ code: "invalid-type" });
});

it("rejects cancellation and input failures asynchronously", async () => {
  const signal = AbortSignal.abort();
  await expect(Presentation(undefined, { signal })).rejects.toMatchObject({ code: "cancelled" });
  await expect(
    Presentation({
      read: async () => {
        throw new Error("private detail");
      }
    })
  ).rejects.toMatchObject({ code: "io-failure" });
  await expect(Presentation(new Uint8Array([1, 2]))).rejects.toMatchObject({
    code: "invalid-archive"
  });
  await expect(Presentation(undefined, { timestamp: "today" as never })).rejects.toMatchObject({
    code: "invalid-value"
  });
});

it("validates lengths synchronously before changing live state", async () => {
  const deck = await Presentation();
  for (const value of [null, 10, new Inches(0), new Inches(57)]) {
    expect(() => {
      deck.slide_width = value as never;
    }).toThrow();
    expect(deck.slide_width?.inches).toBe(10);
  }
});

it("rejects stale model publication before invoking a sink", async () => {
  const deck = await Presentation();
  const sink = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const saving = deck.save(sink);
  deck.core_properties.title = "Changed during serialization";
  await expect(saving).rejects.toMatchObject({ code: "stale-selection" });
  expect(sink.write).not.toHaveBeenCalled();
});

it("publishes complete validated bytes with isolated ownership and reports failures", async () => {
  const deck = await Presentation();
  const chunks: Uint8Array[] = [];
  const sink = {
    write: vi.fn(async (bytes: Uint8Array) => {
      chunks.push(bytes.slice());
      bytes.fill(0);
    }),
    close: vi.fn(async () => {})
  };
  await expect(deck.save(sink)).resolves.toBeUndefined();
  expect(sink.close).not.toHaveBeenCalled();
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  expect((await Presentation(joined)).slide_height?.inches).toBe(7.5);
  await expect(
    deck.save({
      write: async () => {
        throw new Error("private detail");
      },
      close: async () => {}
    })
  ).rejects.toMatchObject({ code: "io-failure" });
});

it("cancels serialization before publishing and delegates atomic VFS stale checks", async () => {
  const controller = new AbortController();
  const deck = await Presentation(undefined, { signal: controller.signal });
  const sink = { write: vi.fn(async () => {}), close: async () => {} };
  const saving = deck.save(sink);
  controller.abort();
  await expect(saving).rejects.toMatchObject({ code: "cancelled" });
  expect(sink.write).not.toHaveBeenCalled();
  const publishOutput = vi.fn(async () => {
    throw Object.assign(new Error("stale"), { code: "stale-selection" });
  });
  await expect(
    (await Presentation()).save({ outputPath: "/out", publishOutput })
  ).rejects.toMatchObject({ code: "stale-selection" });
  expect(publishOutput).toHaveBeenCalledOnce();
});

it("advances the atomic in-place baseline and exposes cancellation to publication", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", await (await Presentation()).save());
  const controller = new AbortController();
  let read = false;
  const deck = await Presentation(
    {
      path: "/deck",
      capability: {
        openRead: async () => ({
          read: async () =>
            read ? null : ((read = true), new Uint8Array(volume.readFileSync("/deck") as Buffer))
        })
      }
    },
    { signal: controller.signal }
  );
  const publishOutput = vi.fn(
    async (request: import("./command-engine.js").PptxPublicationRequest, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      const current = new Uint8Array(volume.readFileSync("/deck") as Buffer);
      if (
        current.length !== request.originalBytes.length ||
        current.some((b, i) => b !== request.originalBytes[i])
      )
        throw Object.assign(new Error("changed"), { code: "stale-selection" });
      volume.writeFileSync(request.outputPath, request.bytes);
    }
  );
  deck.core_properties.title = "First";
  await deck.save({ outputPath: "/deck", inPlace: true, publishOutput });
  deck.core_properties.title = "Second";
  await deck.save({ outputPath: "/deck", inPlace: true, publishOutput });
  expect(
    (await Presentation(new Uint8Array(volume.readFileSync("/deck") as Buffer))).core_properties
      .title
  ).toBe("Second");
  await expect(deck.save(null as never)).rejects.toMatchObject({ code: "invalid-type" });
  await expect(deck.save("/deck" as never)).rejects.toMatchObject({ code: "invalid-type" });
});

it("allows a pending atomic capability to cancel without publishing", async () => {
  const controller = new AbortController();
  const deck = await Presentation(undefined, { signal: controller.signal });
  const published = vi.fn();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const saving = deck.save({
    outputPath: "/out",
    publishOutput: async (_request, signal) => {
      entered();
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
      );
      published();
    }
  });
  await started;
  controller.abort();
  await expect(saving).rejects.toMatchObject({ code: "cancelled" });
  expect(published).not.toHaveBeenCalled();
});

it("shares synchronous canvas editing with the operation engine and rejects conditional settings", async () => {
  const { applyPresentationCanvasSettings } = await import("./presentation-settings.js");
  const { parseXmlPart } = await import("./xml.js");
  const parse = (body: string) =>
    parseXmlPart(
      new TextEncoder().encode(
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${body}</p:presentation>`
      ),
      { maxBytes: 4096, maxNodes: 100, maxDepth: 20 }
    );
  expect(() =>
    applyPresentationCanvasSettings(parse("<mc:AlternateContent/>"), {
      width: 9144000,
      height: 6858000
    })
  ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  expect(() => applyPresentationCanvasSettings(parse(""), { width: 9144000 })).toThrow();
  const updated = applyPresentationCanvasSettings(parse('<p:notesSz cx="1" cy="1"/>'), {
    width: 9144000,
    height: 6858000
  });
  expect(updated.root.children.map((node) => node.name.localName)).toEqual(["sldSz", "notesSz"]);
});

it("creates missing core properties on access and maps absent canvas companion defaults", async () => {
  const original = await (await Presentation()).save();
  const stripped = storedArchive(
    inspectZip(original)
      .filter((entry) => entry.name !== "docProps/core.xml")
      .map((entry) => {
        let doc = parseXmlPart(entry.payload, { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 });
        const remove = doc.root.children.filter(
          (node) =>
            node.name.localName === "sldSz" ||
            node.attributes.some(
              (attribute) =>
                attribute.value === "docProps/core.xml" || attribute.value === "/docProps/core.xml"
            )
        );
        for (const node of remove.reverse())
          doc = doc.spliceChildren(doc.root, doc.root.children.indexOf(node), 1, []);
        return { name: entry.name, bytes: doc.bytes() };
      })
  );
  const deck = await Presentation(stripped);
  expect(deck.slide_width).toBeNull();
  expect(deck.slide_height).toBeNull();
  expect(inspectZip(await deck.save()).some((entry) => entry.name === "docProps/core.xml")).toBe(
    false
  );
  deck.core_properties.title = "New property part";
  deck.slide_width = new Inches(11);
  expect(deck.slide_height?.inches).toBe(7.5);
  const saved = await deck.save();
  const reopened = await Presentation(saved);
  expect(reopened.core_properties.title).toBe("New property part");
  expect(reopened.slide_width?.inches).toBe(11);
  expect(reopened.slide_height?.inches).toBe(7.5);
});

it("snapshots a class publication capability while retaining its receiver", async () => {
  const deck = await Presentation();
  class Destination {
    outputPath = "/initial";
    #paths: string[] = [];
    async publishOutput(request: import("./command-engine.js").PptxPublicationRequest) {
      this.#paths.push(request.outputPath);
    }
    get paths() {
      return this.#paths;
    }
  }
  const destination = new Destination();
  const saving = deck.save(destination);
  destination.outputPath = "/changed";
  await saving;
  expect(destination.paths).toEqual(["/initial"]);
});
