import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const fields = [
 { owner: "style", member: "name", value: false, error: "type" },
 { owner: "style", member: "style_id", value: false, error: "type" },
 { owner: "style", member: "name", value: "", error: "value" },
 { owner: "style", member: "style_id", value: "", error: "value" },
 ...["hidden", "locked", "quick_style", "unhide_when_used"].map(member => ({ owner: "style", member, value: "false", error: "type" })),
 ...["priority"].flatMap(member => [{ owner: "style", member, value: "1", error: "type" }, ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ owner: "style", member, value, error: "value" }))]),
 ...["default_to_hidden", "default_to_locked", "default_to_quick_style", "default_to_unhide_when_used"].map(member => ({ owner: "latent", member, value: "false", error: "type" })),
 ...["default_priority", "load_count"].flatMap(member => [{ owner: "latent", member, value: "1", error: "type" }, ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ owner: "latent", member, value, error: "value" }))]),
 ...["hidden", "locked", "quick_style", "unhide_when_used"].map(member => ({ owner: "entry", member, value: "false", error: "type" })),
 { owner: "entry", member: "priority", value: "1", error: "type" },
 ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ owner: "entry", member: "priority", value, error: "value" }))
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const type of ["PARAGRAPH", "CHARACTER", "TABLE", "LIST"] as const)
 for (const { owner, member, value, error } of fields.filter(field => field.owner === "style" || type === "PARAGRAPH"))
 it(`raises neutral ${error} errors for ${owner}.${member}=${value}; ${type}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>');
  const doc = await api.Document(input, textContext), styles = doc.styles, style = styles.add_style("Atlas", api.WD_STYLE_TYPE[type]), latent = styles.latent_styles, entry = latent.add_latent_style("Known");
  const target = owner === "style" ? style : owner === "latent" ? latent : entry;
  const memory = Volume.fromJSON({ "/before": "", "/after": "" });
  await doc.save({ async write(bytes) { memory.appendFileSync("/before", bytes); } });
  const before = styles.part.blob, mainBefore = doc.part.blob;
  expect(() => Reflect.set(target, member, value)).toThrow(error === "type" ? api.InputTypeError : api.InvalidValueError);
  expect(styles.part.blob).toEqual(before); expect(doc.part.blob).toEqual(mainBefore);
  await doc.save({ async write(bytes) { memory.appendFileSync("/after", bytes); } });
  expect(readPackage(new Uint8Array(memory.readFileSync("/after") as Buffer))).toEqual(readPackage(new Uint8Array(memory.readFileSync("/before") as Buffer)));
  expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊"); expect(styles.at("Atlas").style_id).toBe(style.style_id); expect(latent.at("Known").name).toBe("Known");
 });

const calls = [
 { owner: "styles", member: "has", arguments: [12] }, { owner: "styles", member: "at", arguments: [12] },
 { owner: "styles", member: "add_style", arguments: [12, api.WD_STYLE_TYPE.PARAGRAPH] },
 { owner: "styles", member: "add_style", arguments: ["New", false] },
 { owner: "styles", member: "add_style", arguments: ["New", api.WD_STYLE_TYPE.PARAGRAPH, 1] },
 { owner: "styles", member: "default", arguments: [false] },
 { owner: "styles", member: "get_by_id", arguments: [12, api.WD_STYLE_TYPE.PARAGRAPH] },
 { owner: "styles", member: "get_by_id", arguments: [null, false] },
 { owner: "styles", member: "get_style_id", arguments: [null, false] },
 { owner: "latent", member: "has", arguments: [12] }, { owner: "latent", member: "at", arguments: [12] },
 { owner: "latent", member: "add_latent_style", arguments: [12] }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const { owner, member, arguments: arguments_ } of calls)
 it(`raises neutral input errors for ${owner}.${member}(${JSON.stringify(arguments_)}); ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const doc = await api.Document(input, textContext), styles = doc.styles, latent = styles.latent_styles;
  const target = owner === "styles" ? styles : latent, before = styles.part.blob, mainBefore = doc.part.blob;
  expect(() => Reflect.apply(Reflect.get(target, member) as (...args: unknown[]) => unknown, target, arguments_)).toThrow(api.InputTypeError);
  expect(styles.part.blob).toEqual(before); expect(doc.part.blob).toEqual(mainBefore);
 });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const owner of ["styles", "latent"] as const)
 it(`rejects an empty style identifier with the neutral value class; ${owner}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const doc = await api.Document(input, textContext), styles = doc.styles, latent = styles.latent_styles, before = styles.part.blob, mainBefore = doc.part.blob;
  expect(() => owner === "styles" ? styles.add_style("", api.WD_STYLE_TYPE.PARAGRAPH) : latent.add_latent_style("")).toThrow(api.InvalidValueError);
  expect(styles.part.blob).toEqual(before); expect(doc.part.blob).toEqual(mainBefore);
 });
