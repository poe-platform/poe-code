import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { readPresentationText } from "./text-reading.js";
import { applyTemplateBindings, type TemplateBinding } from "./template-bindings.js";
import { inspectZip } from "../tests/zip-reader.js";
import { addTable } from "./table-operations.js";
import { addImage } from "./image-insertion.js";
import { writePackageArchive } from "./package-writer.js";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const binding = (
  name: string,
  text: string,
  cardinality: "one" | "all" = "one"
): TemplateBinding => ({ kind: "text", name, text, scope: "slides", slide: 1, cardinality });
async function fixture(text: string) {
  const bytes = await createPresentation(
    {
      slides: [
        { shapes: [{ x: 0, y: 0, width: 1000, height: 1000, text }] },
        { shapes: [{ x: 0, y: 0, width: 1000, height: 1000, text: "{{untouched}}" }] }
      ]
    },
    context
  );
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.pptx", bytes);
  return new Uint8Array(volume.readFileSync("/input.pptx") as Buffer);
}
describe("typed template bindings", () => {
  it("binds Unicode and literal braces once without cascading", async () => {
    const source = await fixture("{literal} {{first}} / {{second}} / {{first}}");
    const result = await applyTemplateBindings(
      source,
      [binding("first", "{{second}} Ω 😀", "all"), binding("second", "東京")],
      context
    );
    expect((await readPresentationText(result.bytes, {}, context)).text).toBe(
      "{literal} {{second}} Ω 😀 / 東京 / {{second}} Ω 😀\n{{untouched}}"
    );
    expect(result.affected).toBe(3);
  });
  it("validates missing, unknown, duplicate and ambiguous bindings without touching bytes", async () => {
    const source = await fixture("{{title}} {{title}} {{body}}");
    const before = source.slice();
    const cases = [
      { bindings: [binding("title", "x", "all")], code: "missing-binding" },
      { bindings: [binding("extra", "x")], code: "missing-binding" },
      { bindings: [binding("title", "x"), binding("body", "y")], code: "ambiguous-selection" },
      {
        bindings: [
          binding("title", "x", "all"),
          binding("title", "z", "all"),
          binding("body", "y")
        ],
        code: "invalid-value"
      }
    ];
    for (const entry of cases)
      await expect(applyTemplateBindings(source, entry.bindings, context)).rejects.toMatchObject({
        code: entry.code
      });
    expect(source).toEqual(before);
  });
  it("rejects getters without executing them and rejects non-JSON structured text", async () => {
    let reads = 0;
    const value = {
      ...binding("title", "x"),
      get text() {
        reads++;
        return "x";
      }
    };
    await expect(
      applyTemplateBindings(await fixture("{{title}}"), [value], context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(reads).toBe(0);
    await expect(
      applyTemplateBindings(
        await fixture("{{title}}"),
        [{ ...binding("title", "x"), text: { value: "x" } }] as unknown as TemplateBinding[],
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("preserves cross-run formatting and unaffected package parts", async () => {
    const source = await fixture("{{title}}");
    const entries = inspectZip(source).map((x) => ({ name: x.name, bytes: x.payload }));
    const slide = entries.find((x) => x.name === "ppt/slides/slide1.xml")!;
    slide.bytes = new TextEncoder().encode(
      new TextDecoder()
        .decode(slide.bytes)
        .replace(
          "<a:r><a:t>{{title}}</a:t></a:r>",
          '<a:r><a:rPr b="1"/><a:t>{{ti</a:t></a:r><a:r><a:rPr i="1"/><a:t>tle}} tail</a:t></a:r>'
        )
    );
    const input = await writePackageArchive(entries, context, { compression: "store" });
    const result = await applyTemplateBindings(input, [binding("title", "海")], context);
    const output = inspectZip(result.bytes);
    expect(new TextDecoder().decode(output.find((x) => x.name === slide.name)!.payload)).toContain(
      '<a:rPr b="1"/><a:t>海</a:t></a:r><a:r><a:rPr i="1"/><a:t> tail</a:t>'
    );
    for (const entry of entries.filter((x) => x.name !== slide.name))
      expect(output.find((x) => x.name === entry.name)!.payload).toEqual(entry.bytes);
  });
});

async function rename(bytes: Uint8Array, from: string, to: string) {
  const entries = inspectZip(bytes).map((item) => ({ name: item.name, bytes: item.payload }));
  const slide = entries.find((item) => item.name === "ppt/slides/slide1.xml")!;
  slide.bytes = new TextEncoder().encode(new TextDecoder().decode(slide.bytes).replace(from, to));
  return writePackageArchive(entries, context, { compression: "store" });
}
it("binds a structured table while retaining geometry and cell formatting", async () => {
  const deck = await createPresentation({ slides: [{}] }, context);
  const added = await addTable(
    deck,
    {
      slide: 1,
      update: {
        rows: 1,
        columns: 2,
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 500, unit: "emu" },
        height: { value: 300, unit: "emu" },
        data: [["old", "spare"]],
        fill: "135790"
      }
    },
    context
  );
  const source = await rename(added.bytes, 'name="Table 2"', 'name="{{grid}}"');
  const values: TemplateBinding[] = [
    {
      kind: "table",
      name: "grid",
      scope: "slides",
      slide: 1,
      cardinality: "one",
      table: [["{{literal}} 海", "42"]]
    }
  ];
  const result = await applyTemplateBindings(source, values, context);
  expect(result.affected).toBe(1);
  expect((await readPresentationText(result.bytes, {}, context)).text).toBe("{{literal}} 海\n42");
  const xml = new TextDecoder().decode(
    inspectZip(result.bytes).find((item) => item.name === "ppt/slides/slide1.xml")!.payload
  );
  expect(xml).toContain('val="135790"');
  await expect(
    applyTemplateBindings(
      source,
      [{ ...values[0]!, table: [["wrong"]] }] as TemplateBinding[],
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it("replaces embedded image slots with independent bytes and preserves picture geometry", async () => {
  const original = new Uint8Array([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 4, 18, 32, 220, 170, 80, 44, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 2, 2, 68, 1, 0, 59
  ]);
  const next = original.slice();
  next[13] = 45;
  const deck = await createPresentation({ slides: [{}] }, context);
  const added = await addImage(
    deck,
    { slide: 1, bytes: original, contentType: "image/gif", left: 123, width: 456, height: 789 },
    context
  );
  const source = await rename(added, 'name="Picture 2"', 'name="{{badge}}"');
  const result = await applyTemplateBindings(
    source,
    [
      {
        kind: "image",
        name: "badge",
        scope: "slides",
        slide: 1,
        cardinality: "one",
        image: { bytes: [...next], contentType: "image/gif" }
      }
    ],
    context
  );
  const entries = inspectZip(result.bytes);
  expect(entries.find((item) => item.name === "ppt/media/binding1.gif")!.payload).toEqual(next);
  expect(entries.find((item) => item.name === "ppt/media/image1.gif")!.payload).toEqual(original);
  expect(
    new TextDecoder().decode(entries.find((item) => item.name === "ppt/slides/slide1.xml")!.payload)
  ).toContain('<a:off x="123" y="0"/><a:ext cx="456" cy="789"/>');
});
it("rejects executable-shaped values and unknown fields without invoking conversion", async () => {
  let calls = 0;
  const source = await fixture("{{title}}");
  const coercion = {
    toString() {
      calls++;
      return "text";
    }
  };
  const sparse: unknown[] = new Array(1);
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, "0", {
    get() {
      calls++;
      return binding("title", "x");
    },
    configurable: true
  });
  const cases: unknown[] = [
    [{ ...binding("title", "x"), kind: coercion }],
    [{ ...binding("title", "x"), extra: "ignored" }],
    [{ ...binding("title", "x"), scope: "masters" }],
    [{ ...binding("title", "x"), slide: 0 }],
    [{ kind: "text", name: "title", scope: "slides", slide: 1, text: "x" }],
    sparse,
    accessor,
    [
      {
        kind: "table",
        name: "grid",
        scope: "slides",
        slide: 1,
        cardinality: "all",
        table: [["a"], ["b", "c"]]
      }
    ],
    [
      {
        kind: "image",
        name: "badge",
        scope: "slides",
        slide: 1,
        cardinality: "one",
        image: { bytes: [256], contentType: "image/gif" }
      }
    ]
  ];
  for (const value of cases)
    await expect(
      applyTemplateBindings(source, value as TemplateBinding[], context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  expect(calls).toBe(0);
});
it("treats an empty binding list as a byte-identical no-change result", async () => {
  const source = await fixture("{{title}}");
  expect(await applyTemplateBindings(source, [], context)).toEqual({
    bytes: source,
    affected: 0,
    locations: []
  });
});
it("owns text values before asynchronous document admission", async () => {
  const source = await fixture("{{title}}");
  const bindings = [
    {
      kind: "text" as const,
      name: "title",
      scope: "slides" as const,
      slide: 1,
      cardinality: "one" as const,
      text: "stable"
    }
  ];
  const pending = applyTemplateBindings(source, bindings, context);
  bindings[0]!.text = "changed";
  const result = await pending;
  expect((await readPresentationText(result.bytes, {}, context)).text).toBe(
    "stable\n{{untouched}}"
  );
});
it("rejects an empty media type during stored-data validation", async () => {
  const { validateTemplateBindings } = await import("./template-bindings.js");
  expect(() =>
    validateTemplateBindings([
      {
        kind: "image",
        name: "badge",
        scope: "slides",
        slide: 1,
        cardinality: "one",
        image: { bytes: [1], contentType: "" }
      }
    ])
  ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
});
it.each(["x".repeat(40000), "海".repeat(15000), "😀".repeat(10000)])(
  "bounds multiplied replacement text before package publication (%#)",
  async (value) => {
    const source = await fixture("{{title}} {{title}} {{title}}");
    await expect(
      applyTemplateBindings(source, [binding("title", value, "all")], context)
    ).rejects.toMatchObject({ code: "resource-limit", phase: "validate-intent" });
  }
);
it.each([
  { kind: "text", text: "海".repeat(4) },
  { kind: "text", text: "😀".repeat(3) },
  { kind: "table", table: [["海海", "😀"]] }
])("admits UTF-8 payload bytes before reading input: $kind", async (payload) => {
  const read = vi.fn(async () => null);
  await expect(
    applyTemplateBindings(
      { read },
      [
        { name: "slot", scope: "slides", slide: 1, cardinality: "one", ...payload }
      ] as TemplateBinding[],
      { ...context, limits: { ...context.limits, maxBytes: 9 } }
    )
  ).rejects.toMatchObject({ code: "resource-limit", phase: "admit" });
  expect(read).not.toHaveBeenCalled();
});
it("applies the XML payload ceiling in bytes independently of the total budget", async () => {
  const read = vi.fn(async () => null);
  await expect(
    applyTemplateBindings({ read }, [binding("slot", "海😀海")], {
      ...context,
      xmlLimits: { ...context.xmlLimits, maxBytes: 9 }
    })
  ).rejects.toMatchObject({ code: "resource-limit", phase: "admit" });
  expect(read).not.toHaveBeenCalled();
});
it("admits a Unicode payload at the exact UTF-8 boundary", async () => {
  const read = vi.fn(async () => null);
  await expect(
    applyTemplateBindings({ read }, [binding("slot", "海😀海")], {
      ...context,
      limits: { ...context.limits, maxBytes: 10 },
      xmlLimits: { ...context.xmlLimits, maxBytes: 10 }
    })
  ).rejects.toMatchObject({ code: "invalid-archive", phase: "parse" });
  expect(read).toHaveBeenCalledOnce();
});
it("rejects multi-paragraph table cells before changing their literal value", async () => {
  const deck = await createPresentation({ slides: [{}] }, context);
  const added = await addTable(
    deck,
    {
      slide: 1,
      update: {
        rows: 1,
        columns: 1,
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 500, unit: "emu" },
        height: { value: 300, unit: "emu" },
        data: [["first"]]
      }
    },
    context
  );
  const named = await rename(added.bytes, 'name="Table 2"', 'name="{{grid}}"');
  const source = await rename(
    named,
    "</a:txBody>",
    "<a:p><a:r><a:t>second</a:t></a:r></a:p></a:txBody>"
  );
  expect((await readPresentationText(source, {}, context)).text).toBe("first\nsecond");
  await expect(
    applyTemplateBindings(
      source,
      [
        {
          kind: "table",
          name: "grid",
          scope: "slides",
          slide: 1,
          cardinality: "one",
          table: [["single"]]
        }
      ],
      context
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
