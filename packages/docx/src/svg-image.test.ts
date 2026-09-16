import { expect, it } from "vitest";
import { admitSvgImage } from "./svg-image.js";
import { svgNamespace, svgContext, staticSvg } from "../tests/fixtures/svg-image.js";
import { DocumentBudget } from "./budget.js";
const xml = (content: string, attributes = "") => new TextEncoder().encode(`<svg xmlns="${svgNamespace}" ${attributes}>${content}</svg>`);
it("admits original static XML without rewriting its exact bytes", () => {
  const before = new Uint8Array(staticSvg);
  expect(admitSvgImage(staticSvg, svgContext)).toBeUndefined();
  expect(staticSvg).toEqual(before);
});
it.each(["#g", "&#35;g"])("admits literal decoded local href %s with namespace-defined attributes", href => {
  expect(() => admitSvgImage(xml(`<defs><path id="g" d="M0 0"/></defs><use href="${href}"/>`), svgContext)).not.toThrow();
  expect(() => admitSvgImage(xml(`<defs><path id="g"/></defs><use xlink:href="${href}"/>`, 'xmlns:xlink="http://www.w3.org/1999/xlink"'), svgContext)).not.toThrow();
});
it.each(["url(#g)", "url( '#g' )", 'url( &quot;g:x.y&quot; )'])('parses the entire admitted local resource token %s', value => {
  const token = value.includes('g:x.y') ? value.replace('g:x.y', '#g:x.y') : value;
  expect(() => admitSvgImage(xml(`<defs><linearGradient id="${value.includes('g:x.y') ? 'g:x.y' : 'g'}"/></defs><rect fill="${token}"/>`), svgContext)).not.toThrow();
});
it.each(["none", "currentColor", "transparent", "red", "#123", "#1234", "#123456", "#12345678", "rgb(0, 255, 1e2)", "rgb(0%,100%,50%)", "rgba(0,1,2,.5)", "hsl(-1e2,0%,100%)", "hsla(12.5,50%,50%,25%)"])("admits complete bounded color %s", value => {
  expect(() => admitSvgImage(xml(`<rect fill="${value}"/>`), svgContext)).not.toThrow();
});
it.each(["url(#g) red", "URL(#g)", "url(#g", "url('#g\")", "url(#missing)", "url(https://invalid.example/x)", "url(%23g)", "url(\\23g)", "var(--x)", "@import x", "#12", "rgb(256,0,0)", "rgb(1%,2,3)", "rgb(1,2,3) junk", "rgba(1,2,3,2)", "hsl(0,1,2)", "rgb(1e999,0,0)", "rgb(1 2 3)", "rgb(0x1,2,3)"])("rejects incomplete, encoded, external or invalid paint %s", value => {
  const escaped = value.split('&').join('&amp;').split('"').join('&quot;');
  expect(() => admitSvgImage(xml(`<defs><linearGradient id="g"/></defs><rect fill="${escaped}"/>`), svgContext)).toThrow();
});
it.each([
  '<script/>', '<foreignObject/>', '<image href="#g"/>', '<animate/>', '<style/>', '<rect onload="unsafe"/>', '<rect style="fill:red"/>', '<rect class="x"/>',
  '<rect xmlns="urn:foreign"/>', '<rect unknown="x"/>', '<use href="#g" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#g"/>',
  '<use href="https://invalid.example/x"/>', '<rect href="#g"/>', '<g id="g"/><g id="g"/>', '<g id="9bad"/>', '<g xml:base="https://invalid.example/"/>',
  '<g id="g"><use href="#g"/></g>', '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs>',
  '<linearGradient id="g" fill="url(#g)"/>', '<rect xmlns:f="urn:foreign" f:href="#g"/>'
])("rejects unsafe or recursive static input %s", content => {
  expect(() => admitSvgImage(xml(content), svgContext)).toThrow();
});
it.each(['<?xml-stylesheet href="https://invalid.example/x"?>', '<!DOCTYPE svg [<!ENTITY x "unsafe">]>'])("rejects prohibited XML prolog %s", prolog => {
  expect(() => admitSvgImage(new TextEncoder().encode(prolog + `<svg xmlns="${svgNamespace}"/>`), svgContext)).toThrow();
});
it("admits declarations/comments and rejects processing instructions inside/after the root", () => {
  expect(() => admitSvgImage(new TextEncoder().encode(`<?xml version="1.0"?><!--keep--><svg xmlns="${svgNamespace}"/>`), svgContext)).not.toThrow();
  for (const value of [xml('<?unsafe x?>'), new TextEncoder().encode(`<svg xmlns="${svgNamespace}"/><?unsafe x?>`)]) expect(() => admitSvgImage(value, svgContext)).toThrow();
});
it("enforces input/work/retention bounds and cancellation", () => {
  for (const budget of [new DocumentBudget({ work: 1 }), new DocumentBudget({ xmlPartBytes: 8 }), new DocumentBudget({ retainedBytes: 8 })]) expect(() => admitSvgImage(staticSvg, { ...svgContext, budget })).toThrow();
  const controller = new AbortController(); controller.abort();
  expect(() => admitSvgImage(staticSvg, { ...svgContext, signal: controller.signal })).toThrow();
});
