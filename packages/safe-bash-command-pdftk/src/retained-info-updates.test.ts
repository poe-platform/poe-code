import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { retainedInfoUpdates } from "./retained-info-updates.js";

it.each(["bookmark", "label", "info"])("spills a %s line before its producer reaches the delimiter", async kind => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let writes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => { writes++; return handle.write!(...args); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  async function* chunks() {
    yield new TextEncoder().encode(kind === "bookmark" ? "BookmarkBegin\nBookmarkTitle: " : kind === "label" ? "PageLabelBegin\nPageLabelPrefix: " : "InfoBegin\nInfoKey: Title\nInfoValue: ");
    const bytes = new Uint8Array(4096).fill(65);
    for (let i = 0; i < 128; i++) { if (i === 96) expect(writes).toBeGreaterThan(0); yield bytes; }
    yield new TextEncoder().encode(" &#x1F600;\nBookmarkLevel: 1\nBookmarkPageNumber: 1\n");
  }
  let found = 0;
  for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs: guarded, directory: "/scratch" })) {
    if (update.kind !== "bookmark" && update.kind !== "label" && update.kind !== "info") continue;
    const text = update.kind === "bookmark" ? update.title : update.kind === "label" ? update.prefix : update.value;
    expect(typeof text).toBe("function"); if (typeof text !== "function") throw new Error("text was collected");
    let length = 0, tail = "";
    for await (const part of text()) { expect(part.length).toBeLessThanOrEqual(4096); length += part.length; tail = (tail + part).slice(-3); }
    expect(length).toBe(524291); expect(tail).toBe(" 😀"); found++;
  }
  expect(found).toBe(1); expect(await fs.readdir("/scratch")).toEqual([]);
});

it("retains decoded page label prefixes as repeatable streams", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* chunks() { yield new TextEncoder().encode("PageLabelBegin\nPageLabelPrefix: A&#x1F600; \nPageLabelNewIndex: 2\n"); }
  for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs, directory: "/scratch" })) {
    expect(update.kind).toBe("label"); if (update.kind !== "label") throw new Error("expected label");
    expect(typeof update.prefix).toBe("function");
    if (typeof update.prefix !== "function") throw new Error("prefix was collected");
    for (let repeat = 0; repeat < 2; repeat++) { let value = ""; for await (const part of update.prefix()) value += part; expect(value).toBe("A😀"); }
  }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("rejects invalid entities even in overwritten prefixes and cleans backing", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* chunks() { yield new TextEncoder().encode("PageLabelBegin\nPageLabelPrefix: &#1114112;\nPageLabelPrefix: valid\n"); }
  await expect((async () => { for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs, directory: "/scratch" })) void update; })()).rejects.toThrow(RangeError);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves integer defaults, clamping and decimal suffix rules with retained lines", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* chunks() {
    yield new TextEncoder().encode("BookmarkBegin\nBookmarkTitle: chapter\nBookmarkLevel: ");
    for (let i = 0; i < 32; i++) yield new Uint8Array(4096).fill(48);
    yield new TextEncoder().encode("2suffix\nBookmarkPageNumber: +99999999999999999999999999\nPageLabelBegin\nPageLabelStart: -3\nPageLabelNewIndex: 0x12\nPageMediaBegin\nPageMediaNumber: 1suffix\nPageMediaRotation: -090tail\n");
  }
  const records: unknown[] = [];
  for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs, directory: "/scratch" })) {
    if (update.kind === "bookmark") records.push({ ...update, title: "chapter" });
    else records.push(update);
  }
  expect(records).toEqual([
    { kind: "bookmark", title: "chapter", level: 2, pageNumber: Number.MAX_SAFE_INTEGER },
    { kind: "label", index: 0, start: 1, prefix: "", style: "D" },
    { kind: "page", pageNumber: 1, property: "rotation", values: [-90] },
  ]);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("retains large geometry spellings and preserves rectangle versus dimension validation", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* chunks() {
    yield new TextEncoder().encode("PageMediaBegin\nPageMediaNumber: 1\nPageMediaDimensions: 1");
    for (let i = 0; i < 32; i++) yield new Uint8Array(4096).fill(48);
    yield new TextEncoder().encode("e-131072 2 invalid\nPageMediaRect: 0 0 3 4\nPageMediaRect: 0 0 5 6 invalid\nPageMediaCropBox: 0 0 0x10 0b10\n");
  }
  const records = []; for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs, directory: "/scratch" })) records.push(update);
  expect(records).toEqual([
    { kind: "page", pageNumber: 1, property: "media", values: [0, 0, 3, 4] },
    { kind: "page", pageNumber: 1, property: "dimensions", values: [1, 2] },
    { kind: "page", pageNumber: 1, property: "crop", values: [0, 0, 16, 2] },
  ]);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("streams decoded info values and consumes only the first value in a stanza", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* chunks() { yield new TextEncoder().encode("InfoBegin\nInfoKey: Title\nInfoValue: value&#x1F600;\nInfoValue: &#1114112;\n"); }
  let count = 0;
  for await (const update of retainedInfoUpdates(chunks(), new AbortController().signal, { fs, directory: "/scratch" })) {
    if (update.kind !== "info") throw new Error("expected info");
    expect(typeof update.value).toBe("function"); if (typeof update.value !== "function") throw new Error("value was collected");
    let value = ""; for await (const part of update.value()) value += part; expect(value).toBe("value😀"); count++;
  }
  expect(count).toBe(1); expect(await fs.readdir("/scratch")).toEqual([]);
});
