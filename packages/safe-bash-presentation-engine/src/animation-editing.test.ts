import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseXmlPart } from "./xml.js";
import { applyAnimationEdit } from "./animation-editing.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const limits = { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 };
const document = (extra = "") =>
  parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Card"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Badge"/></p:nvSpPr></p:sp></p:spTree></p:cSld>${extra}</p:sld>`
    ),
    limits
  );
function values(doc: ReturnType<typeof document>, name: string, attribute: string) {
  const result: string[] = [],
    pending = [doc.root];
  while (pending.length) {
    const n = pending.shift()!;
    if (n.name.localName === name)
      result.push(n.attributes.find((a) => a.name.localName === attribute)?.value ?? "");
    pending.push(...n.children);
  }
  return result;
}
describe("simple animation authoring", () => {
  it.each(["appear", "fade-in", "fade-out", "pulse"] as const)(
    "authors %s with valid targets and distinct IDs",
    (kind) => {
      const doc = applyAnimationEdit(document(), "add", {
        kind,
        trigger: "on-click",
        targetId: "2"
      });
      expect(values(doc, "spTgt", "spid")).toEqual(kind === "pulse" ? ["2", "2"] : ["2"]);
      const ids = values(doc, "cTn", "id");
      expect(new Set(ids).size).toBe(ids.length);
      expect(values(doc, "cTn", "dur")).toContain(
        kind === "appear" ? "0" : kind === "pulse" ? "250" : "500"
      );
      if (kind === "pulse") {
        expect(values(doc, "to", "x")).toEqual(["110000", "100000"]);
      }
      if (kind.startsWith("fade"))
        expect(values(doc, "animEffect", "transition")).toEqual([
          kind === "fade-in" ? "in" : "out"
        ]);
    }
  );
  it("chains previous-effect triggers and prevents stranded references", () => {
    let doc = applyAnimationEdit(document(), "add", {
      kind: "fade-in",
      trigger: "on-click",
      targetId: "2"
    });
    doc = applyAnimationEdit(doc, "add", {
      kind: "pulse",
      trigger: "after-previous",
      targetId: "3",
      delay: 17
    });
    expect(values(doc, "tn", "val")).toEqual(["3"]);
    expect(values(doc, "cond", "evt")).toContain("onEnd");
    expect(() => applyAnimationEdit(doc, "remove", { shapeIds: ["2"] })).toThrowError(/strand/);
    doc = applyAnimationEdit(doc, "set", { shapeIds: ["3"], trigger: "on-click" });
    doc = applyAnimationEdit(doc, "remove", { shapeIds: ["2"] });
    expect(values(doc, "spTgt", "spid")).toEqual(["3", "3"]);
  });
  it("rejects missing predecessors, targets and invalid duration", () => {
    expect(() =>
      applyAnimationEdit(document(), "add", {
        kind: "pulse",
        trigger: "with-previous",
        targetId: "2"
      })
    ).toThrow();
    expect(() =>
      applyAnimationEdit(document(), "add", { kind: "appear", trigger: "on-click", targetId: "99" })
    ).toThrow();
    expect(() =>
      applyAnimationEdit(document(), "add", {
        kind: "appear",
        trigger: "on-click",
        targetId: "2",
        duration: 1
      })
    ).toThrow();
  });
  it("preserves unrelated timeline XML and rejects opaque main sequences", () => {
    const opaque =
      '<p:timing><p:tnLst><p:audio><p:cMediaNode><p:cTn id="90"/></p:cMediaNode></p:audio></p:tnLst></p:timing>';
    const doc = applyAnimationEdit(document(opaque), "add", {
      kind: "appear",
      trigger: "on-click",
      targetId: "2"
    });
    expect(doc.markup(doc.root)).toContain(
      '<p:audio><p:cMediaNode><p:cTn id="90"/></p:cMediaNode></p:audio>'
    );
    expect(
      Math.min(
        ...values(doc, "cTn", "id")
          .filter((id) => id !== "90")
          .map(Number)
      )
    ).toBe(91);
    const complex = document(
      '<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:animMotion path="M 0 0 L 1 1"/></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
    );
    expect(() =>
      applyAnimationEdit(complex, "add", { kind: "appear", trigger: "on-click", targetId: "2" })
    ).toThrowError(/Unsupported/);
  });
});

it("schedules dependent effects in a shared parallel click group and splits odd pulse durations", () => {
  let doc = applyAnimationEdit(document(), "add", {
    kind: "fade-in",
    trigger: "on-click",
    targetId: "2"
  });
  doc = applyAnimationEdit(doc, "add", {
    kind: "pulse",
    trigger: "with-previous",
    targetId: "3",
    duration: 501
  });
  const stack = [doc.root];
  let main: typeof doc.root | undefined;
  while (stack.length) {
    const n = stack.pop()!;
    if (n.attributes.some((a) => a.name.localName === "nodeType" && a.value === "mainSeq"))
      main = n;
    stack.push(...n.children);
  }
  const groups = main!.children.find((n) => n.name.localName === "childTnLst")!.children;
  expect(groups).toHaveLength(1);
  const groupChildren = groups[0]!.children[0]!.children.find(
    (n) => n.name.localName === "childTnLst"
  )!.children;
  expect(groupChildren).toHaveLength(2);
  expect(values(doc, "cond", "evt")).toContain("onBegin");
  expect(values(doc, "cTn", "dur")).toContain("250");
  expect(values(doc, "cTn", "dur")).toContain("251");
  doc = applyAnimationEdit(doc, "set", { shapeIds: ["3"], trigger: "on-click" });
  expect(values(doc, "cond", "evt").filter((v) => v === "onClick")).toHaveLength(2);
  const ids = values(doc, "cTn", "id");
  expect(new Set(ids).size).toBe(ids.length);
});

it("rejects changes that discard an externally referenced scale phase and unknown text payloads", () => {
  let doc = applyAnimationEdit(document(), "add", {
    kind: "pulse",
    trigger: "on-click",
    targetId: "2"
  });
  const timing = doc.root.children.find((n) => n.name.localName === "timing")!;
  const list = timing.children[0]!;
  const second = values(doc, "cTn", "id").at(-1)!;
  doc = doc.spliceChildren(list, list.children.length, 0, [
    `<p:par xmlns:p="${p}"><p:cTn id="90"><p:stCondLst><p:cond evt="onEnd"><p:tn val="${second}"/></p:cond></p:stCondLst></p:cTn></p:par>`
  ]);
  expect(() => applyAnimationEdit(doc, "set", { shapeIds: ["2"], kind: "fade-out" })).toThrowError(
    /strand/
  );
  const nodes = [doc.root];
  let scale: typeof doc.root | undefined;
  while (nodes.length) {
    const node = nodes.pop()!;
    if (
      node.name.localName === "to" &&
      node.attributes.some((a) => a.name.localName === "x" && a.value === "110000")
    )
      scale = node;
    nodes.push(...node.children);
  }
  const altered = doc.merge(scale!, {
    attributes: [{ namespace: "", localName: "x", value: "110001" }]
  });
  expect(() => applyAnimationEdit(altered, "set", { shapeIds: ["2"], duration: 100 })).toThrowError(
    /Unsupported/
  );
});

import { createPresentation } from "./creation.js";
import { mutateAnimations, mutateAnimationsBatch } from "./animation-editing.js";
import { readAnimations } from "./animations.js";
import { readSelectionIndex } from "./selectors.js";
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
  xmlLimits: limits,
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
const slidePosition = { coordinateSystem: "one-based" as const, value: 1 };
async function deck() {
  return createPresentation(
    {
      slides: [
        {
          shapes: [
            { name: "Card", x: 0, y: 0, width: 100, height: 100, text: "Card" },
            { name: "Badge", x: 100, y: 0, width: 100, height: 100, text: "Badge" }
          ]
        }
      ]
    },
    context
  );
}
it("atomically rebinds dependent triggers before deleting an effect using original selectors", async () => {
  let bytes = await deck();
  bytes = (
    await mutateAnimations(
      bytes,
      "add",
      { kind: "appear", trigger: "on-click", target: { slide: slidePosition, shape: "Card" } },
      context
    )
  ).bytes;
  bytes = (
    await mutateAnimations(
      bytes,
      "add",
      {
        kind: "pulse",
        trigger: "after-previous",
        target: { slide: slidePosition, shape: "Badge" }
      },
      context
    )
  ).bytes;
  const index = await readSelectionIndex(bytes, context);
  const first = index.objects.find((n) => n.name === "Card")!,
    second = index.objects.find((n) => n.name === "Badge")!;
  const result = await mutateAnimationsBatch(
    bytes,
    [
      { action: "set", options: { selection: { token: second.token }, trigger: "on-click" } },
      { action: "remove", options: { selection: { token: first.token } } }
    ],
    context
  );
  expect(result.affected).toBe(2);
  expect(
    result.results.map((operation) => operation.locations.map((location) => location.fingerprint))
  ).toEqual([[index.fingerprint], [index.fingerprint]]);
  expect(result.locations.map((location) => location.fingerprint)).toEqual([
    index.fingerprint,
    index.fingerprint
  ]);
  const records = await readAnimations(result.bytes, {}, context);
  expect(records[0]!.diagnostics).toEqual([]);
  expect(records[0]!.targetShapeIds).toEqual([second.id]);
  await expect(
    mutateAnimationsBatch(
      bytes,
      [
        { action: "remove", options: { selection: { token: first.token } } },
        { action: "set", options: { selection: { token: second.token }, trigger: "on-click" } }
      ],
      context
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  expect((await readAnimations(bytes, {}, context))[0]!.targetShapeIds).toHaveLength(2);
});
it("rejects accessors, non-shape locations and invalid SDK actions before package reads", async () => {
  let reads = 0;
  const options = Object.defineProperty({}, "target", {
    get() {
      reads++;
      return "bad";
    }
  });
  await expect(mutateAnimations(new Uint8Array(), "add", options, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(reads).toBe(0);
  await expect(mutateAnimations(new Uint8Array(), "set", {}, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  await expect(
    mutateAnimations(new Uint8Array(), "remove", { duration: 3 }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
});

it("retains an empty unrecognized timing root and refuses to reconstruct it", () => {
  const doc = document(
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"/></p:par></p:tnLst></p:timing>'
  );
  const original = doc.bytes();
  expect(() =>
    applyAnimationEdit(doc, "add", { kind: "appear", trigger: "on-click", targetId: "2" })
  ).toThrowError(/Unsupported/);
  expect(doc.bytes()).toEqual(original);
});

it("validates empty batches and rejects sparse or executable operation arrays", async () => {
  const bytes = await deck();
  const result = await mutateAnimationsBatch(bytes, [], context);
  expect(result.bytes).toEqual(bytes);
  expect(result.results).toEqual([]);
  expect(result.affected).toBe(0);
  let calls = 0;
  const operations = Object.defineProperty([], "0", {
    get() {
      calls++;
      return { action: "remove", options: {} };
    }
  });
  await expect(mutateAnimationsBatch(bytes, operations, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(calls).toBe(0);
  await expect(mutateAnimationsBatch(bytes, new Array(2), context)).rejects.toMatchObject({
    code: "invalid-value"
  });
});

it("classifies an imported indefinite effect as unsupported instead of invalid caller input", () => {
  const doc = applyAnimationEdit(document(), "add", {
    kind: "fade-in",
    trigger: "on-click",
    targetId: "2"
  });
  const pending = [doc.root];
  let effect: typeof doc.root | undefined;
  while (pending.length) {
    const n = pending.pop()!;
    if (n.attributes.some((a) => a.name.localName === "nodeType" && a.value === "clickEffect"))
      effect = n;
    pending.push(...n.children);
  }
  const imported = doc.merge(effect!, {
    attributes: [{ namespace: "", localName: "dur", value: "indefinite" }]
  });
  expect(() =>
    applyAnimationEdit(imported, "set", { shapeIds: ["2"], duration: 100 })
  ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
});

it("rejects ambiguous named animation targets", async () => {
  const shape = { name: "Card", x: 0, y: 0, width: 100, height: 100, text: "Card" };
  const bytes = await createPresentation(
    { slides: [{ shapes: [shape, { ...shape, x: 200 }] }] },
    context
  );
  await expect(
    mutateAnimations(
      bytes,
      "add",
      {
        kind: "appear",
        trigger: "on-click",
        target: { slide: slidePosition, shape: "Card" }
      },
      context
    )
  ).rejects.toMatchObject({ code: "ambiguous-selection" });
});

it.each(["slide", "subrun"] as const)(
  "rejects a %s target instead of animating its containing object",
  async (kind) => {
    const bytes = await deck();
    const index = await readSelectionIndex(bytes, context);
    const target =
      kind === "slide" ? index.slides[0]!.token : { ...index.objects[0]!.location, run: 0 };
    await expect(
      mutateAnimations(bytes, "add", { kind: "appear", trigger: "on-click", target }, context)
    ).rejects.toMatchObject({ code: kind === "slide" ? "invalid-selection" : "invalid-value" });
  }
);

it("rejects a stale object token after an intervening animation edit", async () => {
  const bytes = await deck();
  const index = await readSelectionIndex(bytes, context);
  const target = index.objects[0]!.token;
  const edited = await mutateAnimations(
    bytes,
    "add",
    { kind: "appear", trigger: "on-click", target },
    context
  );
  await expect(
    mutateAnimations(
      edited.bytes,
      "add",
      { kind: "fade-out", trigger: "on-click", target },
      context
    )
  ).rejects.toMatchObject({ code: "stale-selection" });
});

it("rejects an animation target outside the selected slide", async () => {
  const shape = { name: "Card", x: 0, y: 0, width: 100, height: 100, text: "Card" };
  const bytes = await createPresentation(
    { slides: [{ shapes: [shape] }, { shapes: [shape] }] },
    context
  );
  const index = await readSelectionIndex(bytes, context);
  const target = index.objects.find((object) => object.part === index.slides[1]!.part)!.token;
  await expect(
    mutateAnimations(
      bytes,
      "add",
      {
        selection: { token: index.slides[0]!.token },
        kind: "appear",
        trigger: "on-click",
        target
      },
      context
    )
  ).rejects.toMatchObject({ code: "invalid-selection" });
});
