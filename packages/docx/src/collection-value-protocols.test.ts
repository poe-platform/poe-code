import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { textContext, w, textFixture, paragraph } from "../tests/fixtures/text.js";

function paragraphOwner() {
  const volume = Volume.fromJSON({ "/paragraph": `<w:p xmlns:w="${w}"><w:r><w:t>Tide gauge</w:t></w:r></w:p>` });
  return { getXml: () => volume.readFileSync("/paragraph", "utf8") as string, setXml: (xml: string) => { volume.writeFileSync("/paragraph", xml); }, part: "local-part", identity: Object.freeze({}) };
}

it("provides immutable zero-based RGB numeric lookup and explicit signed at", () => {
  const color = new api.RGBColor(0, 255, 0);
  expect(color[0]).toBe(0);
  expect(color[1]).toBe(255);
  expect(color[2]).toBe(0);
  expect(color.at(-1)).toBe(0);
  expect(color.at(-3)).toBe(0);
  expect(() => color[3]).toThrow(RangeError);
  expect(color[-1]).toBe(0);
  expect(() => color[-4]).toThrow(RangeError);
  expect(() => color[0.5]).toThrow(TypeError);
  expect(() => Reflect.set(color, "0", 12)).toThrow(TypeError);
});

it("exposes an immutable RGB tuple and iterator-returning reverse protocol", () => {
  const color = new api.RGBColor(4, 0, 255);
  expect(color.toArray()).toEqual([4, 0, 255]);
  expect(Object.isFrozen(color.toArray())).toBe(true);
  expect(color.reversed().next()).toEqual({ done: false, value: 255 });
  expect([...color.reversed()]).toEqual([255, 0, 4]);
  expect([...color]).toEqual([4, 0, 255]);
});

it("returns a real reverse iterator rather than an array snapshot", () => {
  expect(typeof new api.RGBColor(1, 0, 255).reversed().next).toBe("function");
});

it("keeps color zero distinct from false and clamps signed half-open slices", () => {
  const color = new api.RGBColor(0, 42, 0);
  expect(color.count(0)).toBe(2);
  expect(color.count(false as unknown as number)).toBe(0);
  expect(color.includes(false as unknown as number)).toBe(false);
  expect(color.slice(-2)).toEqual([42, 0]);
  expect(color.slice(-100, 100)).toEqual([0, 42, 0]);
  expect(color.slice(2, 1)).toEqual([]);
  expect(color.index(0, -2)).toBe(2);
  expect(() => color.index(0, 1, -1)).toThrow(RangeError);
  for (const value of [NaN, Infinity, 0.5, false, null, "0"]) expect(() => color.at(value as number)).toThrow(TypeError);
  for (const value of ["#000000", " 000000", "000000 ", "００００００", "00000", "0000000", 0, null]) expect(() => api.RGBColor.from_string(value as string)).toThrow(TypeError);
  expect(api.RGBColor.from_string("aB00fF").toString()).toBe("AB00FF");
});

it("keeps tab numeric lookup zero-based and supports signed at without slicing", () => {
  const tabs = new api.ParagraphFormat(paragraphOwner()).tab_stops;
  tabs.add_tab_stop(api.Pt(0));
  tabs.add_tab_stop(api.Pt(10));
  expect(tabs[0]!.position.emu).toBe(0);
  expect(tabs.at(-1).position.pt).toBe(10);
  expect(tabs[-1]!.position.pt).toBe(10);
  expect(() => tabs[-3]).toThrow(RangeError);
  expect(() => tabs[0.5]).toThrow(TypeError);
  expect(() => tabs[2]).toThrow(RangeError);
  expect(() => Reflect.deleteProperty(tabs, "0")).toThrow(TypeError);
  expect(() => Object.defineProperty(tabs, "0", { value: "unrelated" })).toThrow(TypeError);
  expect(Reflect.get(tabs, "slice")).toBeUndefined();
});

it("snapshots tab iteration membership before sorted movement and insertion", () => {
  const tabs = new api.ParagraphFormat(paragraphOwner()).tab_stops;
  const first = tabs.add_tab_stop(api.Pt(1));
  const second = tabs.add_tab_stop(api.Pt(2));
  const iterator = tabs[Symbol.iterator]();
  expect(iterator.next().value.equals(first)).toBe(true);
  first.position = api.Pt(3);
  tabs.add_tab_stop(api.Pt(1.5));
  const remaining = [...iterator];
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.equals(second)).toBe(true);
  expect([...tabs].map(stop => stop.position.pt)).toEqual([1.5, 2, 3]);
});

it.each([-2, 0.5, NaN, Infinity])("rejects invalid numeric tab property %s", index => {
  const tabs = new api.ParagraphFormat(paragraphOwner()).tab_stops;
  tabs.add_tab_stop(api.Pt(0));
  expect(() => tabs[index]).toThrow(index < 0 ? RangeError : TypeError);
});

it("rejects numeric tab property deletion and definition", () => {
  const tabs = new api.ParagraphFormat(paragraphOwner()).tab_stops;
  tabs.add_tab_stop(api.Pt(0));
  expect(() => Reflect.deleteProperty(tabs, "0")).toThrow(TypeError);
  expect(() => Object.defineProperty(tabs, "0", { value: "unrelated" })).toThrow(TypeError);
});

it("invalidates removed tab metadata even through the existing deletion spelling", () => {
  const tabs = new api.ParagraphFormat(paragraphOwner()).tab_stops;
  const stop = tabs.add_tab_stop(api.Pt(0));
  tabs.delete(0);
  expect(() => stop.part).toThrow(RangeError);
  expect(() => stop.equals(stop)).toThrow(RangeError);
});

it("retains tab handles across repeated live paragraph views of one owner", async () => {
  const { styles } = await api.openDocumentStyleModel(undefined, textContext);
  const style = styles.add_style("Channel alignment", api.WD_STYLE_TYPE.PARAGRAPH);
  const firstView = style.paragraph_format.tab_stops;
  const first = firstView.add_tab_stop(api.Pt(1));
  const secondView = style.paragraph_format.tab_stops;
  const second = secondView.add_tab_stop(api.Pt(2));
  expect(first.position.pt).toBe(1);
  second.position = api.Pt(0);
  expect(first.position.pt).toBe(1);
  expect(firstView.at(0).equals(second)).toBe(true);
  expect(secondView.at(1).equals(first)).toBe(true);
});

it("uses value errors for RGB search misses and invalid units", () => {
  expect(() => new api.RGBColor(0, 1, 2).index(3)).toThrow(api.InvalidValueError);
  expect(() => api.Length(false as unknown as number)).toThrow(api.InputTypeError);
  expect(() => api.Length(Number.MAX_SAFE_INTEGER + 1)).toThrow(api.InvalidValueError);
});

it("maps tab deletion to remove and invalidates the removed handle metadata", () => {
  const tabs = new api.ParagraphFormat(paragraphOwner()).tab_stops;
  const zero = tabs.add_tab_stop(api.Pt(0));
  const last = tabs.add_tab_stop(api.Pt(4));
  tabs.remove(-1);
  expect(tabs.length).toBe(1);
  expect(tabs.at(0).equals(zero)).toBe(true);
  expect(() => last.position).toThrow(api.StaleHandleError);
  expect(() => last.part).toThrow(api.StaleHandleError);
  expect(() => last.equals(last)).toThrow(api.StaleHandleError);
  expect(() => zero.equals(last)).toThrow(api.StaleHandleError);
  const replacement = tabs.add_tab_stop(api.Pt(4));
  expect(() => last.equals(replacement)).toThrow(api.StaleHandleError);
  tabs.clear_all();
  expect(tabs.length).toBe(0);
  expect(() => zero.part).toThrow(api.StaleHandleError);
});

it("uses typed stable bounds and key errors while nullable lookups remain null", async () => {
  expect(api.BoundsError).toBeDefined();
  expect(api.MissingKeyError).toBeDefined();
  const color = new api.RGBColor(1, 2, 3);
  expect(() => color.at(3)).toThrow(api.BoundsError);
  const model = await api.openDocumentStyleModel(undefined, textContext);
  expect(() => model.styles.at("Absent style")).toThrow(api.MissingKeyError);
  expect(model.styles.get_by_id(null, api.WD_STYLE_TYPE.CHARACTER)).toBeNull();
  const bounds = new api.BoundsError("Index is out of range.");
  expect(bounds).toBeInstanceOf(RangeError);
  expect(bounds.code).toBe("missing-selection");
  expect(new api.MissingKeyError("Key is absent.").code).toBe("missing-selection");
});

it("preserves live keyed styles across sparse IDs and mutation without ordinal aliases", async () => {
  const { styles } = await api.openDocumentStyleModel(undefined, textContext);
  const zero = styles.add_style("Depth zero", api.WD_STYLE_TYPE.PARAGRAPH);
  const far = styles.add_style("Depth far", api.WD_STYLE_TYPE.CHARACTER);
  zero.style_id = "Slot0"; far.style_id = "Slot99";
  expect(styles.at("Depth zero").equals(zero)).toBe(true);
  expect(styles.at("Slot99").equals(far)).toBe(true);
  expect(styles.get_by_id("Slot99", api.WD_STYLE_TYPE.CHARACTER)?.equals(far)).toBe(true);
  expect(styles.has("Slot99")).toBe(false);
  expect(() => styles.at(0 as unknown as string)).toThrow(TypeError);
  const before = styles.length;
  zero.delete();
  expect(styles.length).toBe(before - 1);
  expect(styles.has("Depth zero")).toBe(false);
  expect(styles.at("Depth far").style_id).toBe("Slot99");
  expect(() => zero.part).toThrow(api.StaleHandleError);
  const latent = styles.latent_styles;
  const entry = latent.add_latent_style("Depth latent");
  entry.priority = 0; entry.hidden = false;
  expect(latent.at("Depth latent").priority).toBe(0);
  expect(latent.at("Depth latent").hidden).toBe(false);
  entry.priority = null; entry.hidden = null;
  expect(entry.priority).toBeNull(); expect(entry.hidden).toBeNull();
  entry.delete();
  expect(() => latent.at("Depth latent")).toThrow(api.MissingKeyError);
  expect(() => entry.part).toThrow(api.StaleHandleError);
  expect(() => latent.at(0 as unknown as string)).toThrow(TypeError);
});

it("checks all unit helpers with zero, signed halfway conversion and safe EMU ownership", () => {
  for (const factory of [api.Length, api.Emu, api.Inches, api.Cm, api.Mm, api.Pt, api.Twips]) {
    expect(factory(0).emu).toBe(0);
    for (const value of [NaN, Infinity, -Infinity, false, null, "1"]) expect(() => factory(value as number)).toThrow(TypeError);
    expect(() => factory(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  }
  expect(api.Cm(2.53).emu).toBe(910800);
  expect(api.Emu(9144.9).emu).toBe(9145);
  expect(api.Length(Number.MAX_SAFE_INTEGER).emu).toBe(Number.MAX_SAFE_INTEGER);
  expect(api.Twips(0.5).emu).toBe(318);
  expect(api.Twips(-0.5).emu).toBe(-318);
  expect(api.Pt(1.25).pt).toBe(1.25);
  expect(api.Mm(12.7).inches).toBe(0.5);
});

it("reduces RGB reverse iterators to typed batch arrays without cloning executable values", async () => {
  const input = await textFixture(paragraph("Waterline sample"));
  const result = await applyStyleModelBatch(input, { version: 1, operations: [
    { operation: "model.shared.RGBColor.call", arguments: { r: 0, g: 11, b: 255 }, resultHandle: "color" },
    { operation: "model.shared.RGBColor.__reversed__.call", receiver: { resultHandle: "color" }, arguments: {} },
    { operation: "model.shared.RGBColor.tuple_value_protocol.call", receiver: { resultHandle: "color" }, arguments: {} }
  ] }, textContext);
  expect(result.results[1]!.value).toEqual([255, 11, 0]);
  expect(result.results[2]!.value).toEqual([0, 11, 255]);
  expect(result.affected).toBe(0);
});

it("reports valid missing sequence targets through shared CLI JSON and exit status", async () => {
  const input = await textFixture(paragraph("Current markers"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/stdout": "", "/stderr": "" });
  const ops = { version: 1, operations: [
    { operation: "model.shared.RGBColor.call", arguments: { r: 0, g: 11, b: 255 }, resultHandle: "color" },
    { operation: "model.shared.RGBColor.__getitem__.call", receiver: { resultHandle: "color" }, arguments: { index: 3 } }
  ] };
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify(ops), "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { volume.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(volume.readFileSync("/stdout", "utf8") as string)).toMatchObject({ version: 1, operation: "batch", ok: false, data: null, affected: 0, errors: [{ code: "missing-selection" }] });
  expect(volume.readFileSync("/stderr", "utf8")).not.toContain("Current markers");
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it("reports invalid enum values as usage errors through shared CLI JSON", async () => {
  const input = await textFixture(paragraph("Current bearings"));
  let stdout = "";
  const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations: [
      { operation: "model.enum.section.WD_ORIENTATION.fromValue.call", arguments: { value: 99999 } }
    ] }), "--json"].map(value => new TextEncoder().encode(value)),
    cwd: "/", signal: textContext.signal,
    filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(stdout)).toMatchObject({ operation: "batch", ok: false, data: null, affected: 0, errors: [{ code: "usage" }] });
});
