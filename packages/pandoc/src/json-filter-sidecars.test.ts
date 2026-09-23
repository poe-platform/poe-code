import {expect, it} from "vitest";
import {createJsonFilterCapability} from "./json-filters.js";
import {createExecutionContext} from "./execution.js";
import type {Document} from "./types.js";

it("keeps SDK resources and sidecars outside the JSON filter protocol", async () => {
  const document: Document = {
    blocks: [{t: "Para", c: [{t: "Str", c: "Hello"}]}],
    metadata: {title: {t: "MetaString", c: "Before"}},
    resources: [{id: "/image.png", bytes: Uint8Array.of(1, 2, 3)}],
    language: "en", direction: "rtl"
  };
  const filters = createJsonFilterCapability({async run({stdin, stdout}) {
    const wire = JSON.parse(new TextDecoder().decode(stdin));
    expect(Object.keys(wire).sort()).toEqual(["blocks", "meta", "pandoc-api-version"]);
    wire.blocks[0].c[0].c = "HELLO";
    wire.meta.title.c = "After";
    await stdout.write(new TextEncoder().encode(JSON.stringify(wire)));
    return 0;
  }});
  const result = await filters.apply(document, {kind: "json", path: "uppercase.py"},
    Object.assign(createExecutionContext("convert"), {to: "html"}));
  expect(result).toEqual({...document,
    blocks: [{t: "Para", c: [{t: "Str", c: "HELLO"}]}],
    metadata: {title: {t: "MetaString", c: "After"}}
  });
  expect(result.resources).toBe(document.resources);
  expect(document.blocks).toEqual([{t: "Para", c: [{t: "Str", c: "Hello"}]}]);
});

it("rejects filter attempts to replace SDK-owned sidecars", async () => {
  const document: Document = {blocks: [], metadata: {}, resources: [], language: "en"};
  const filters = createJsonFilterCapability({async run({stdin, stdout}) {
    const wire = JSON.parse(new TextDecoder().decode(stdin));
    wire.language = "fr";
    await stdout.write(new TextEncoder().encode(JSON.stringify(wire)));
    return 0;
  }});
  await expect(filters.apply(document, {kind: "json", path: "bad.py"},
    Object.assign(createExecutionContext("convert"), {to: "html"}))).rejects.toMatchObject({code: "E_AST"});
  expect(document.language).toBe("en");
});

it("does not traverse resource bytes when checking wire image targets", async () => {
  const document: Document = {blocks: [], metadata: {}, resources: [{id: "/image", bytes: new Uint8Array(10_000)}]};
  const filters = createJsonFilterCapability({async run({stdin, stdout}) {
    await stdout.write(stdin);
    return 0;
  }});
  const result = await filters.apply(document, {kind: "json", path: "identity.py"},
    Object.assign(createExecutionContext("convert", {limits: {work: 1_000}}), {to: "html"}));
  expect(result.resources).toBe(document.resources);
});
