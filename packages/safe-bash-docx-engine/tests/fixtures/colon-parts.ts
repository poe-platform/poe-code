import { crc32, deflateRawSync } from "node:zlib";

/** Original ZIP32 wire fixture, independent of product name admission and writing. */
export function colonPartFixture(strict: boolean, kind: "docx" | "dotx", compression: "store" | "deflate", main: string) {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const rel = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const directory = main.split("/").slice(0, -1).join("/"), filename = main.split("/").at(-1)!;
  const relationshipName = `${directory ? directory + "/" : ""}_rels/${filename}.rels`;
  const parts = new Map<string, Uint8Array>(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/${main}" ContentType="${type}"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--Retained binding--><Relationship Id="main" Type="${rel}/officeDocument" Target="/${main}"/></Relationships>`,
    [main]: `<?xml version="1.0"?><!--Retained prolog--><n:document xmlns:n="${word}"><n:body><n:p><n:r><n:t>Original estuary</n:t></n:r><!--Retained sibling--><?audit keep?></n:p></n:body></n:document>`,
    [relationshipName]: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--Inert resource--><Relationship Id="payload" Type="urn:estuary:payload" Target="/archive/retained.bin"/></Relationships>'
  }).map(([name, value]) => [name, new TextEncoder().encode(value)]));
  parts.set("archive/retained.bin", Uint8Array.of(0, 127, 128, 255));
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of parts) {
    const encoded = Buffer.from(name), payload = compression === "deflate" ? deflateRawSync(bytes) : Buffer.from(bytes), checksum = crc32(bytes);
    const local = Buffer.alloc(30), central = Buffer.alloc(46), method = compression === "store" ? 0 : 8;
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(2048, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(0x5c22, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(encoded.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(2048, 8); central.writeUInt16LE(method, 10); central.writeUInt16LE(0x5c22, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(encoded.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, encoded, payload); centrals.push(central, encoded); offset += local.length + encoded.length + payload.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.size, 8); end.writeUInt16LE(parts.size, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return { input: new Uint8Array(Buffer.concat([...locals, central, end])), parts, main, relationshipName, word, rel, type };
}
