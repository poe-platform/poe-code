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
  const body = xml.children[0]!;
  const div = body.children[0]!;
  assert.equal(body.localName, "body");
  assert.equal(div.localName, "div");
  const cues = div.children;
  assert.equal(cues.length, 2);
  for (const element of [body, div, ...cues, ...cues.flatMap(cue => cue.children)]) {
    assert.equal(element.namespace, xml.namespace);
  }
  assert.deepEqual(cues.map(cue => [cue.localName, ...cue.attributes.map(attr => [attr.localName, attr.value])]), [
    ["p", ["begin", "00:00:01.240"], ["end", "00:00:02.800"]],
    ["p", ["begin", "00:00:03.400"], ["end", "00:00:05.000"]]
  ]);
  const span = cues[0]!.children[0]!;
  assert.equal(span.localName, "span");
  assert.deepEqual(span.content.map(node => node.kind === "element" ? node.localName : "text" in node ? node.text : ""),
    ["First line", "br", "continuation"]);
  assert.equal(span.children[0]!.namespace, xml.namespace);
  assert.equal(cues[1]!.children[0]!.text, "Last & final < €2 >");
});
