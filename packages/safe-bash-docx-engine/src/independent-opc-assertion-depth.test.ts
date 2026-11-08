import { expect, it } from "vitest";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const depth of [0, 4096, 8192]) for (const valid of [false, true])
    it(`independent OPC assertions inspect actual depth ${depth} XML; valid=${valid}; ${kind}; strict=${strict}`, async () => {
      const base = await nativeStoryFixture("parts.comments.CommentsPart", strict, kind, "<w:p/>");
      const parts = readPackage(base.input), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = base.relationships;
      const body = '<f:pass>'.repeat(depth) + '<w:p><w:hyperlink r:id="link"><w:r><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:hyperlink></w:p>' + '</f:pass>'.repeat(depth);
      parts.set("word/native.xml", new TextEncoder().encode(`<w:comments xmlns:w="${w}" xmlns:r="${r}" xmlns:f="urn:original:assertion-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:comment w:id="2" w:author="Original">${body}</w:comment><!--retain--><?policy keep?></w:comments>`));
      if (valid) parts.set("word/_rels/native.xml.rels", new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link" Type="${r}/hyperlink" Target="https://example.invalid/retained" TargetMode="External"/></Relationships>`));
      const before = new Map([...parts].map(([name, bytes]) => [name, bytes.slice()]));
      if (valid) expect(() => assertPackageLinks(parts)).not.toThrow();
      else expect(() => assertPackageLinks(parts)).toThrow("missing relationships for word/native.xml");
      expect(parts).toEqual(before);
    });
