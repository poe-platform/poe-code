export const nativePartSourceCases = [
  { row: 524, kind: "comments", action: "load", root: "comments", reserved: 0 },
  { row: 525, kind: "comments", action: "view", root: "comments", reserved: 0 },
  { row: 526, kind: "comments", action: "default", root: "comments", reserved: 0 },
  { row: 548, kind: "footer", action: "load", root: "ftr", reserved: 0 },
  { row: 549, kind: "footer", action: "new", root: "ftr", reserved: 23 },
  { row: 550, kind: "footer", action: "new", root: "ftr", reserved: 0 },
  { row: 551, kind: "header", action: "load", root: "hdr", reserved: 0 },
  { row: 552, kind: "header", action: "new", root: "hdr", reserved: 41 },
  { row: 553, kind: "header", action: "new", root: "hdr", reserved: 0 },
  { row: 566, kind: "settings", action: "load", root: "settings", reserved: 0 },
  { row: 567, kind: "settings", action: "view", root: "settings", reserved: 0 },
  { row: 568, kind: "settings", action: "default", root: "settings", reserved: 0 },
  { row: 583, kind: "styles", action: "view", root: "styles", reserved: 0 },
  { row: 584, kind: "styles", action: "default", root: "styles", reserved: 0 }
] as const;

export type NativePartSourceCase = typeof nativePartSourceCases[number];

/** Original authored asset data; no production parser/editor is used. */
export function nativePartSourceParts(c: NativePartSourceCase, strict: boolean,
  kind: "document" | "template", base = "word", prefix = "w", carrier = "direct") {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" :
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" :
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const known = prefix === "default" ? "w" : prefix;
  const spell = (body: string) => prefix === "default" ?
    body.split("<w:").join("<").split("</w:").join("</") : body.split("w:").join(prefix + ":");
  const root = (local: string, body: string) => {
    const tag = prefix === "default" ? local : prefix + ":" + local;
    return `<${tag} ${prefix === "default" ? `xmlns="${w}" ` : ""}xmlns:${known}="${w}" xmlns:r="${r}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:factory" mc:Ignorable="f" mc:ProcessContent="f:pass">${spell(body)}</${tag}>`;
  };
  const wrap = (body: string) => carrier === "direct" ? body : carrier === "process" ?
    `<f:pass>${body}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? known : "f"}">${carrier === "choice" ? body : "<f:opaque><!--inert factory branch--></f:opaque>"}</mc:Choice><mc:Fallback>${carrier === "fallback" ? body : "<f:opaque><!--inert factory branch--></f:opaque>"}</mc:Fallback></mc:AlternateContent>`;
  const enc = (text: string) => new TextEncoder().encode(text);
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${c.kind}+xml`;
  const names = Array.from({ length: c.reserved }, (_, i) => `${base}/${c.kind}${i + 1}.xml`);
  const main = `${base}/document.xml`, rels = `${base}/_rels/document.xml.rels`;
  const parts = new Map<string, Uint8Array>([
    ["[Content_Types].xml", enc(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}.main+xml"/>${names.map(name => `<Override PartName="/${name}" ContentType="${type}"/>`).join("")}<!--types retained--></Types>`) ],
    ["_rels/.rels", enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="${main}"/></Relationships>`) ],
    [main, enc(root("document", `<w:body><!--main retained-->${wrap("<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p><w:sectPr/>")}<?policy keep?></w:body>`))],
    [rels, enc(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--edges retained--><Relationship Id="audit" Type="urn:original:audit" Target="../audit/retained.bin"/>${names.map((name, i) => `<Relationship Id="reserve${i + 1}" Type="${r}/${c.kind}" Target="${name.slice(base.length + 1)}"/>`).join("")}<?policy keep?></Relationships>`) ],
    ["audit/retained.bin", new Uint8Array([0, 255, 10, 7])],
    ...names.map(name => [name, enc(root(c.root, "<w:p/>"))] as [string, Uint8Array])
  ]);
  const loadedBody = c.action === "view" ? "<!--view retained--><?policy keep?>" : "";
  const blob = enc(root(c.root, loadedBody));
  const partname = `/${base}/${c.kind}${c.kind === "comments" &&
    (c.action === "load" || c.action === "view") ? "" : c.reserved + 1}.xml`;
  return { parts, w, r, main, rels, type, blob, partname, spell, root, wrap };
}
