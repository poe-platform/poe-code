import { describe, expect, it } from "vitest";
import {
  ActionSetting,
  Hyperlink,
  _Hyperlink,
  PP_ACTION,
  PP_ACTION_TYPE,
  type LinkModelOwner
} from "./links-model.js";
import type { LinkData, SetLinkOptions } from "./links.js";
import { parseXmlPart } from "./xml.js";
function owner(initial: Partial<LinkData> | null = null) {
  let current = initial
    ? ({
        part: "/ppt/slides/slide2.xml",
        path: [],
        location: {},
        shapeId: "2",
        trigger: "click",
        relationshipId: null,
        url: null,
        targetSlide: null,
        action: null,
        kind: "unsupported",
        requiresSanitization: false,
        ...initial
      } as LinkData)
    : null;
  const slides = [{ name: "Opening" }, { name: "Details" }, { name: "Closing" }];
  const writes: Partial<SetLinkOptions>[] = [];
  const part = parseXmlPart(new TextEncoder().encode('<part xmlns="urn:original:links"/>'), {
    maxBytes: 200,
    maxNodes: 5,
    maxDepth: 4
  });
  const result: LinkModelOwner<(typeof slides)[number]> = {
    part,
    slides,
    slide: slides[1]!,
    read: () => current,
    set: (value) => {
      writes.push(value);
      current = {
        ...current,
        ...value,
        kind: value.url ? "url" : "slide",
        action: value.targetSlide ? "ppaction://hlinksldjump" : null,
        requiresSanitization: false
      } as LinkData;
    },
    remove: () => {
      current = null;
    }
  };
  return { result, writes };
}
describe("owned link model", () => {
  it.each([
    [null, "NONE"],
    ["", "HYPERLINK"],
    ["hlinkshowjump?jump=firstslide", "FIRST_SLIDE"],
    ["hlinkshowjump?jump=lastslide", "LAST_SLIDE"],
    ["hlinkshowjump?jump=nextslide", "NEXT_SLIDE"],
    ["hlinkshowjump?jump=previousslide", "PREVIOUS_SLIDE"],
    ["hlinkshowjump?jump=endshow", "END_SHOW"],
    ["hlinksldjump", "NAMED_SLIDE"],
    ["hlinkfile", "OPEN_FILE"],
    ["hlinkpres", "PLAY"],
    ["customshow", "NAMED_SLIDE_SHOW"],
    ["ole", "OLE_VERB"],
    ["macro", "RUN_MACRO"],
    ["program", "RUN_PROGRAM"],
    ["hlinkshowjump?jump=lastslideviewed", "LAST_SLIDE_VIEWED"],
    ["media", "NONE"]
  ] as const)("returns action metadata and a live URL view for %s", (verb, symbol) => {
    const { result } = owner(verb === null ? null : { action: verb ? `ppaction://${verb}` : null });
    const action = new ActionSetting(result);
    expect(action.action).toBe(PP_ACTION[symbol]);
    expect(action.hyperlink).toBeInstanceOf(Hyperlink);
    expect(action.hyperlink).toBe(action.hyperlink);
  });
  it.each([
    null,
    "",
    "hlinkshowjump?jump=endshow",
    "hlinkfile",
    "hlinkpres",
    "customshow",
    "ole",
    "macro",
    "program",
    "hlinkshowjump?jump=lastslideviewed"
  ])("returns no slide object for non-slide action %s", (verb) => {
    const { result } = owner(verb === null ? null : { action: verb ? `ppaction://${verb}` : null });
    expect(new ActionSetting(result).target_slide).toBeNull();
  });
  it("exposes immutable action symbols and alias identity", () => {
    expect(PP_ACTION).toBe(PP_ACTION_TYPE);
    expect(PP_ACTION.NAMED_SLIDE).toEqual({ name: "NAMED_SLIDE", value: 101 });
    expect(PP_ACTION.NEXT_SLIDE.value).toBe(1);
    expect(Object.isFrozen(PP_ACTION)).toBe(true);
    expect(Object.isFrozen(PP_ACTION.NONE)).toBe(true);
  });
  it("classifies an existing empty link separately from an absent link", () => {
    const { result } = owner({ action: null, url: null });
    expect(new ActionSetting(result).action).toBe(PP_ACTION.HYPERLINK);
    expect(new ActionSetting(result).hyperlink.address).toBeNull();
  });
  it("keeps hyperlink views live and synchronously clears absent addresses", () => {
    const { result, writes } = owner();
    const action = new ActionSetting(result);
    const link = action.hyperlink;
    expect(action.action).toBe(PP_ACTION.NONE);
    expect(link.address).toBeNull();
    link.address = "../guide.html";
    expect(link.address).toBe("../guide.html");
    expect(action.action).toBe(PP_ACTION.HYPERLINK);
    expect(writes).toEqual([{ url: "../guide.html" }]);
    link.address = "";
    expect(action.action).toBe(PP_ACTION.NONE);
    expect(action.part).toBe(result.part);
    expect(link.part).toBe(result.part);
    expect(new _Hyperlink(result)).toBeInstanceOf(Hyperlink);
  });
  it.each([
    ["firstslide", 0],
    ["lastslide", 2],
    ["nextslide", 2],
    ["previousslide", 0]
  ] as const)("resolves %s against live slide membership", (jump, index) => {
    const { result } = owner({
      kind: "navigation",
      action: `ppaction://hlinkshowjump?jump=${jump}`
    });
    expect(new ActionSetting(result).target_slide).toBe(result.slides[index]);
  });
  it("sets and clears a same-owner slide while rejecting foreign identities", () => {
    const { result, writes } = owner();
    const action = new ActionSetting(result);
    action.target_slide = result.slides[2]!;
    expect(writes).toEqual([{ targetSlide: 3 }]);
    expect(action.target_slide).toBe(result.slides[2]);
    expect(() => {
      action.target_slide = { name: "Foreign" };
    }).toThrow();
    action.target_slide = null;
    expect(action.target_slide).toBeNull();
  });
  it("raises at a missing navigation boundary and on a removed slide owner", () => {
    const { result } = owner({
      kind: "navigation",
      action: "ppaction://hlinkshowjump?jump=nextslide"
    });
    const action = new ActionSetting({ ...result, slide: result.slides[2]! });
    expect(() => action.target_slide).toThrow();
    expect(
      () => new ActionSetting({ ...result, slide: { name: "Removed" } }).target_slide
    ).toThrow();
  });
  it.each([
    ["program", "RUN_PROGRAM"],
    ["macro", "RUN_MACRO"],
    ["ole", "OLE_VERB"],
    ["hlinkfile", "OPEN_FILE"],
    ["hlinkpres", "PLAY"],
    ["customshow?id=3", "NAMED_SLIDE_SHOW"]
  ] as const)("reports %s inertly and rejects implicit destructive replacement", (verb, symbol) => {
    const { result, writes } = owner({
      kind: "unsupported",
      action: `ppaction://${verb}`,
      requiresSanitization: true
    });
    const action = new ActionSetting(result);
    expect(action.action).toBe(PP_ACTION[symbol]);
    expect(action.target_slide).toBeNull();
    expect(() => {
      action.hyperlink.address = "https://example.test";
    }).toThrow();
    expect(() => {
      action.hyperlink.address = null;
    }).toThrow();
    expect(writes).toEqual([]);
  });
  it.each(["javascript:alert(1)", "file:///local/secret", "data:text/html,x"])(
    "rejects unsafe URL assignment %s",
    (url) => {
      const { result, writes } = owner();
      expect(() => {
        new Hyperlink(result).address = url;
      }).toThrow(expect.objectContaining({ code: "invalid-value" }));
      expect(writes).toEqual([]);
    }
  );
});
