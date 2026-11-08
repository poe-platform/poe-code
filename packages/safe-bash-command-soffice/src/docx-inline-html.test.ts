import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive } from "./index.js";
import { docxDocumentPrefix, docxDocumentSuffix, docxMetadata } from "./docx-parts.js";

it("exports DOCX inline bold and italic through the public command without losing text or escaping", async () => {
  const run = (text: string, properties = "") => `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const runs = run("Plain ") + run("italic", "<w:i/>") + run(" and ") + run("bold", '<w:b w:val="true"/>') + run(" text. ") +
    run("&lt;both&gt;&amp;", '<w:b w:val="1"/><w:i w:val="on"/>') +
    run(" normal", '<w:b w:val="0"/><w:i w:val="false"/>') + run(" off", '<w:b w:val="off"/>');
  const paragraph = `<w:p>${runs}</w:p>`;
  const source = docxDocumentPrefix + paragraph + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runs}</w:p>` +
    `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>${runs}</w:p>` +
    `<w:tbl><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>` + docxDocumentSuffix;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.docx", createStoredZipArchive(Object.fromEntries(Object.entries({
    ...docxMetadata, "word/document.xml": source,
    "word/numbering.xml": '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>' 
  }).map(([name, text]) => [name, new TextEncoder().encode(text)]))));
  let stderr = "";
  const result = await createSofficeCommand().execute({
    command: "soffice", cwd: "/", env: {}, fs,
    ...createCommandArguments(["--headless", "--convert-to", "html", "/input.docx"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const html = new TextDecoder().decode(await fs.readFile("/input.html"));
  const expected = "Plain <i>italic</i> and <b>bold</b> text. <b><i>&lt;both&gt;&amp;</i></b> normal off";
  for (const tag of ["p", "h1", "td", "li"]) assert.ok(html.includes(`<${tag}>${expected}</${tag}>`), html);
});
