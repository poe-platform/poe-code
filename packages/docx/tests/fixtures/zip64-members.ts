import { crc32, deflateRawSync } from "node:zlib";

export interface Zip64DocumentOptions {
  readonly strict: boolean;
  readonly compression: "store" | "deflate";
  readonly fields: "sizes" | "offset" | "both";
  readonly descriptor: "none" | "unsigned" | "signed";
}

/** Original small ZIP fixture; payload framing is independent of the product codec. */
export function zip64Document(options: Zip64DocumentOptions) {
  const namespace = options.strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const rel = options.strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const kind = options.strict ? "dotx" : "docx";
  const parts = new Map<string, Uint8Array>(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/reports/body.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${options.strict ? "template" : "document"}.main+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${rel}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": `<?xml version="1.0"?><!--original--><n:document xmlns:n="${namespace}"><n:body><n:p><n:r><n:t>Wide member</n:t></n:r></n:p></n:body></n:document>`,
    "records/retained.xml": '<record xmlns="urn:original:retained">Unrelated bytes</record>'
  }).map(([name, xml]) => [name, new TextEncoder().encode(xml)]));
  const wideSizes = options.fields !== "offset", wideOffset = options.fields !== "sizes", hasDescriptor = options.descriptor !== "none";
  const locals: Buffer[] = [], central: Buffer[] = [];
  const positions: { localExtra: number; centralExtra: number; descriptor: number; payload: number }[] = [];
  let localOffset = 0;
  for (const [name, bytes] of parts) {
    const filename = Buffer.from(name), payload = options.compression === "deflate" ? deflateRawSync(bytes) : Buffer.from(bytes), checksum = crc32(bytes);
    const localExtra = Buffer.alloc(wideSizes ? 20 : 0);
    if (wideSizes) { localExtra.writeUInt16LE(1, 0); localExtra.writeUInt16LE(16, 2); localExtra.writeBigUInt64LE(BigInt(bytes.length), 4); localExtra.writeBigUInt64LE(BigInt(payload.length), 12); }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt16LE(hasDescriptor ? 8 : 0, 6); local.writeUInt16LE(options.compression === "deflate" ? 8 : 0, 8);
    local.writeUInt16LE(0x1883, 10); local.writeUInt16LE(0x5c22, 12); local.writeUInt32LE(hasDescriptor ? 0 : checksum, 14);
    local.writeUInt32LE(wideSizes ? 0xffffffff : hasDescriptor ? 0 : payload.length, 18); local.writeUInt32LE(wideSizes ? 0xffffffff : hasDescriptor ? 0 : bytes.length, 22);
    local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(hasDescriptor ? (wideSizes ? 20 : 12) + (options.descriptor === "signed" ? 4 : 0) : 0);
    if (hasDescriptor) {
      const start = options.descriptor === "signed" ? 4 : 0;
      if (start) descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, start);
      if (wideSizes) { descriptor.writeBigUInt64LE(BigInt(payload.length), start + 4); descriptor.writeBigUInt64LE(BigInt(bytes.length), start + 12); }
      else { descriptor.writeUInt32LE(payload.length, start + 4); descriptor.writeUInt32LE(bytes.length, start + 8); }
    }
    const extra = Buffer.alloc(4 + (wideSizes ? 16 : 0) + (wideOffset ? 8 : 0));
    extra.writeUInt16LE(1, 0); extra.writeUInt16LE(extra.length - 4, 2);
    if (wideSizes) { extra.writeBigUInt64LE(BigInt(bytes.length), 4); extra.writeBigUInt64LE(BigInt(payload.length), 12); }
    if (wideOffset) extra.writeBigUInt64LE(BigInt(localOffset), wideSizes ? 20 : 4);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(45, 4); header.writeUInt16LE(45, 6); header.writeUInt16LE(hasDescriptor ? 8 : 0, 8); header.writeUInt16LE(options.compression === "deflate" ? 8 : 0, 10);
    header.writeUInt16LE(0x1883, 12); header.writeUInt16LE(0x5c22, 14); header.writeUInt32LE(checksum, 16); header.writeUInt32LE(wideSizes ? 0xffffffff : payload.length, 20); header.writeUInt32LE(wideSizes ? 0xffffffff : bytes.length, 24);
    header.writeUInt16LE(filename.length, 28); header.writeUInt16LE(extra.length, 30); header.writeUInt32LE(wideOffset ? 0xffffffff : localOffset, 42);
    positions.push({ localExtra: localOffset + 30 + filename.length, centralExtra: central.reduce((sum, part) => sum + part.length, 0) + 46 + filename.length, payload: localOffset + local.length + filename.length + localExtra.length, descriptor: localOffset + local.length + filename.length + localExtra.length + payload.length });
    locals.push(local, filename, localExtra, payload, descriptor); central.push(header, filename, extra);
    localOffset += local.length + filename.length + localExtra.length + payload.length + descriptor.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(98), recordOffset = localOffset + directory.length;
  end.writeUInt32LE(0x06064b50, 0); end.writeBigUInt64LE(44n, 4); end.writeUInt16LE(45, 12); end.writeUInt16LE(45, 14);
  end.writeBigUInt64LE(BigInt(parts.size), 24); end.writeBigUInt64LE(BigInt(parts.size), 32); end.writeBigUInt64LE(BigInt(directory.length), 40); end.writeBigUInt64LE(BigInt(localOffset), 48);
  end.writeUInt32LE(0x07064b50, 56); end.writeBigUInt64LE(BigInt(recordOffset), 64); end.writeUInt32LE(1, 72);
  end.writeUInt32LE(0x06054b50, 76); end.writeUInt16LE(65535, 84); end.writeUInt16LE(65535, 86); end.writeUInt32LE(0xffffffff, 88); end.writeUInt32LE(0xffffffff, 92);
  return { input: new Uint8Array(Buffer.concat([...locals, directory, end])), parts, kind, namespace, positions: positions.map(position => ({ ...position, centralExtra: position.centralExtra + localOffset })) };
}
