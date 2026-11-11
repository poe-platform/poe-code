import assert from "node:assert/strict";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { allMediaAsts, createMediaAstRegistry, parseSubtitleDocument } from "./containers/adapters.js";

it("exports namespaced TTML with exact cue timing, line breaks and escaped Unicode text", () => {
  const plugin = createMediaAstRegistry(allMediaAsts()).findById("ttml")!;
  assert.ok(plugin);
  assert.equal(plugin.canDemux, false);
  const doc = parseSubtitleDocument(new TextEncoder().encode(
    "1\n00:00:01,240 --> 00:00:02,800\nFirst line\ncontinuation\n\n2\n00:00:03,400 --> 00:00:05,000\nLast & final < €2 >\n"), "srt");
  const xml = parseXml(new TextDecoder().decode(plugin.serialize(doc)));
  assert.equal(xml.localName, "tt");
  assert.equal(xml.namespace, "http://www.w3.org/ns/ttml");
  assert.deepEqual(xml.attributes.filter(attr => attr.localName === "cellResolution").map(attr => [attr.namespace, attr.localName, attr.value]), [
    ["http://www.w3.org/ns/ttml#parameter", "cellResolution", "384 288"]
  ]);
  const head = xml.children[0]!;
  const layout = head.children[0]!;
  const region = layout.children[0]!;
  assert.deepEqual([head.localName, layout.localName, region.localName], ["head", "layout", "region"]);
  assert.deepEqual(region.attributes.map(attr => [attr.namespace, attr.localName, attr.value]), [
    ["http://www.w3.org/XML/1998/namespace", "id", "Default"],
    ["http://www.w3.org/ns/ttml#styling", "origin", "3% 0%"],
    ["http://www.w3.org/ns/ttml#styling", "extent", "97% 97%"],
    ["http://www.w3.org/ns/ttml#styling", "displayAlign", "after"],
    ["http://www.w3.org/ns/ttml#styling", "textAlign", "center"],
    ["http://www.w3.org/ns/ttml#styling", "fontSize", "16c"],
    ["http://www.w3.org/ns/ttml#styling", "fontFamily", "Arial"],
    ["http://www.w3.org/ns/ttml#styling", "overflow", "visible"]
  ]);
  const body = xml.children[1]!;
  const div = body.children[0]!;
  assert.equal(body.localName, "body");
  assert.equal(div.localName, "div");
  const cues = div.children;
  assert.equal(cues.length, 2);
  for (const element of [head, layout, region, body, div, ...cues, ...cues.flatMap(cue => cue.children)]) {
    assert.equal(element.namespace, xml.namespace);
  }
  assert.deepEqual(cues.map(cue => [cue.localName, ...cue.attributes.map(attr => [attr.localName, attr.value])]), [
    ["p", ["begin", "00:00:01.240"], ["end", "00:00:02.800"]],
    ["p", ["begin", "00:00:03.400"], ["end", "00:00:05.000"]]
  ]);
  for (const cue of cues) {
    assert.deepEqual(cue.children[0]!.attributes.map(attr => [attr.namespace, attr.localName, attr.value]),
      [["", "region", "Default"]]);
  }
  const span = cues[0]!.children[0]!;
  assert.equal(span.localName, "span");
  assert.deepEqual(span.content.map(node => node.kind === "element" ? node.localName : "text" in node ? node.text : ""),
    ["First line", "br", "continuation"]);
  assert.equal(span.children[0]!.namespace, xml.namespace);
  assert.equal(cues[1]!.children[0]!.text, "Last & final < €2 >");
});
