import assert from "node:assert/strict";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { createSyntheticMp4, parseMp4, serializeDashDocument } from "./index.js";

for (const title of ["Cut < test & crop", "Trial & test", '日本語 > "title" </Title> &lt;', "", undefined]) {
  it(`preserves the DASH program title as XML text: ${JSON.stringify(title)}`, () => {
    const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 4, includeAudio: false }));
    const { manifest } = serializeDashDocument({ ...doc, metadata: title === undefined ? {} : { title } });
    const xml = new TextDecoder().decode(manifest);
    const root = parseXml(xml);
    const program = root.children.find(child => child.localName === "ProgramInformation");
    if (!title) {
      assert.equal(program?.children.length ?? 0, 0);
    } else {
      assert.ok(program);
      assert.equal(program.namespace, root.namespace);
      assert.equal(program.children.length, 1);
      assert.equal(program.children[0]!.localName, "Title");
      assert.equal(program.children[0]!.text, title);
      assert.equal(program.children[0]!.children.length, 0);
      if (title === "Cut < test & crop") assert.ok(xml.includes("Cut &lt; test &amp; crop"));
    }
  });
}
