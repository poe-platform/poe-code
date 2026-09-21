import { expect, it } from "vitest";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

const actions: readonly { name: string; run: (latent: api.LatentStyles) => unknown }[] = [
  { name: "length", run: latent => latent.length }, { name: "element", run: latent => latent.element },
  { name: "part", run: latent => latent.part }, { name: "equals", run: latent => latent.equals(latent) },
  { name: "has", run: latent => latent.has("Known") }, { name: "at", run: latent => latent.at("Known") },
  { name: "iteration", run: latent => latent[Symbol.iterator]().next() }, { name: "addition", run: latent => latent.add_latent_style("Another") },
  { name: "hidden get", run: latent => latent.default_to_hidden }, { name: "locked get", run: latent => latent.default_to_locked },
  { name: "quick get", run: latent => latent.default_to_quick_style }, { name: "unhide get", run: latent => latent.default_to_unhide_when_used },
  { name: "priority get", run: latent => latent.default_priority }, { name: "count get", run: latent => latent.load_count },
  { name: "hidden set", run: latent => { latent.default_to_hidden = true; } }, { name: "locked set", run: latent => { latent.default_to_locked = true; } },
  { name: "quick set", run: latent => { latent.default_to_quick_style = true; } }, { name: "unhide set", run: latent => { latent.default_to_unhide_when_used = true; } },
  { name: "priority set", run: latent => { latent.default_priority = 0; } }, { name: "count set", run: latent => { latent.load_count = null; } }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const recreated of [false, true]) for (const action of actions)
it(`invalidates a removed latent collection permanently; ${action.name}; recreated=${recreated}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>');
  const d = await api.Document(input, textContext), styles = d.styles, latent = styles.latent_styles;
  latent.add_latent_style("Known"); styles.element.children.find(node => node.localName === "latentStyles")!.remove();
  if (recreated) expect(styles.latent_styles.length).toBe(0);
  const before = styles.part.blob;
  expect(() => action.run(latent)).toThrow(api.StaleHandleError);
  expect(styles.part.blob).toEqual(before);
  expect(d.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`provides new latent entry tokens and XML after container replacement; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const d = await api.Document(input, textContext), styles = d.styles, old = styles.latent_styles, heldXml = old.element, entry = old.add_latent_style("Known");
  styles.element.children.find(node => node.localName === "latentStyles")!.remove();
  const fresh = styles.latent_styles;
  expect(fresh.length).toBe(0);
  const created = fresh.add_latent_style("Fresh");
  expect(created.name).toBe("Fresh"); expect(fresh.at("Fresh").equals(created)).toBe(true);
  expect(fresh.element.children.some(node => node.localName === "lsdException")).toBe(true);
  expect(() => heldXml.children).toThrow(api.StaleHandleError);
  expect(() => entry.name).toThrow(api.StaleHandleError);
  expect(() => old.length).toThrow(api.StaleHandleError);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`removes the returned latent XML root without a post-mutation failure; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const d = await api.Document(input, textContext), styles = d.styles, latent = styles.latent_styles;
  latent.add_latent_style("Known");
  expect(() => latent.element.remove()).not.toThrow();
  expect(styles.element.children.some(node => node.localName === "latentStyles")).toBe(false);
  expect(() => latent.length).toThrow(api.StaleHandleError);
  expect(styles.latent_styles.add_latent_style("Fresh").name).toBe("Fresh");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const recreated of [false, true]) for (const removal of ["intrinsic", "parent"] as const)
it(`invalidates a partially consumed latent iterator on container removal; recreated=${recreated}; ${removal}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const d = await api.Document(input, textContext), styles = d.styles, old = styles.latent_styles;
  old.add_latent_style("First"); old.add_latent_style("Second");
  const iterator = old[Symbol.iterator]();
  expect(iterator.next().value!.name).toBe("First");
  if (removal === "intrinsic") old.element.remove();
  else styles.element.children.find(node => node.localName === "latentStyles")!.remove();
  if (recreated) styles.latent_styles.add_latent_style("Fresh");
  const before = styles.part.blob;
  expect(() => iterator.next()).toThrow(api.StaleHandleError);
  expect(styles.part.blob).toEqual(before);
});
