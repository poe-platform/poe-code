import {expect, it} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {SaxesParser} from "saxes";
import {convert} from "./engine.js";

it("writes portable styles, code, highlights and working heading anchors like Pandoc", async () => {
  const html = '<h1 id="overview">Overview</h1><h2>Details</h2><p>Body <mark><strong>highlighted</strong></mark> <a href="#overview">heading</a> <a href="https://example.com">external</a></p><pre><code>first\n  second</code></pre><table><tr><th>Name</th><th align="right">Value</th></tr><tr><td>A</td><td align="right">2</td></tr></table>';
  const result = await convert([{bytes: new TextEncoder().encode(html)}], {from: "html", to: "docx"}, {yield: async () => {}});
  if(result.kind !== "binary") throw Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  const xml = (name: string) => new TextDecoder().decode(parts.get(`word/${name}.xml`));
  const styles = xml("styles"), document = xml("document");
  for(const part of parts.values()) if(new TextDecoder().decode(part).startsWith("<")) new SaxesParser({xmlns:true}).write(new TextDecoder().decode(part)).close();
  const style = (id: string) => styles.slice(styles.indexOf(`w:styleId="${id}"`), styles.indexOf("</w:style>", styles.indexOf(`w:styleId="${id}"`)));
  expect(styles).toContain("w:rPrDefault");
  expect(styles).toContain("w:pPrDefault");
  for (const id of ["Heading1", "Heading2"]) {
    expect(style(id)).toContain("w:sz");
    expect(style(id)).toContain("w:keepNext");
    expect(style(id)).toContain("w:spacing");
  }
  expect(style("SourceCode")).toContain("Courier New");
  expect(document).toContain('w:pStyle w:val="SourceCode"');
  expect(document).toContain('w:bookmarkStart');
  expect(document).toContain('w:name="overview"');
  expect(document).toContain('w:anchor="overview"');
  expect(document).toContain('w:shd');
  expect(document).toContain('w:jc w:val="right"');
  expect(document).toContain('w:rStyle w:val="Hyperlink"');
  expect(document).toContain('w:tblCellMar');
});

it("treats HTML's numeric image dimensions as CSS pixels", async () => {
  const {encode} = await import("jpeg-js");
  const bytes = encode({width:2,height:1,data:new Uint8Array(8).fill(255)},80).data;
  const html = `<p>Before <img src="data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}" width="120" height="40"> after.</p>`;
  const result = await convert([{bytes:new TextEncoder().encode(html)}],{from:"html",to:"docx"},{yield:async()=>{},resources:{resolve:async()=>new Uint8Array(bytes)}});
  if(result.kind!=="binary") throw Error("Expected DOCX");
  const xml=new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
  expect(xml).toContain('cx="1143000" cy="381000"');
});

it("retains two-way anchors on links and numbered endnotes", async () => {
  const html='<p>Text <a id="ref" href="#note">1</a></p><ol><li id="note">Note <a href="#ref">back</a></li></ol>';
  const result=await convert([{bytes:new TextEncoder().encode(html)}],{from:"html",to:"docx"},{yield:async()=>{}});
  if(result.kind!=="binary") throw Error("Expected DOCX");
  const xml=new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
  for(const id of ["ref","note"]) {expect(xml).toContain(`w:name="${id}"`);expect(xml).toContain(`w:anchor="${id}"`);}
});
