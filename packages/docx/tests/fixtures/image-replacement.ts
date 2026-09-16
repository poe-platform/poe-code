import { Volume } from "memfs";
import { crc32 } from "@poe-code/office-package";
import { insertDocumentImage } from "../../src/image-insertion.js";
import { readDocumentArchive } from "../../src/admission.js";
import { writeArchive } from "../../src/archive-write.js";
import { createDocumentArchive } from "../../src/create.js";
const textContext = {
  signal: new AbortController().signal,
  limits: {
    maxArchiveBytes: 131072,
    maxEntryBytes: 65536,
    maxTotalBytes: 131072,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 32,
    maxExtraBytes: 0,
    maxCommentBytes: 32,
    maxRetainedBytes: 33554432,
    chunkSize: 1024
  }
};
async function initialFixture() {
  const archive = await createDocumentArchive({}, textContext),
    volume = Volume.fromJSON({ "/out": "" });
  await writeArchive(
    archive,
    {
      async write(bytes) {
        volume.appendFileSync("/out", bytes);
      }
    },
    { order: "input", compression: "store" },
    textContext
  );
  return new Uint8Array(volume.readFileSync("/out") as Uint8Array);
}
export const replacementContext = {
  ...textContext,
  encoding: { order: "input" as const, compression: "store" as const }
};
export { textContext };
export function replacementPng(red = 23) {
  const chunk = (name: string, data: number[]) => {
    const result = new Uint8Array(data.length + 12),
      view = new DataView(result.buffer);
    view.setUint32(0, data.length);
    result.set(new TextEncoder().encode(name), 4);
    result.set(data, 8);
    view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)));
    return result;
  };
  const chunks = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    chunk("IDAT", [
      120,
      1,
      1,
      5,
      0,
      250,
      255,
      0,
      red,
      0,
      0,
      255,
      ...[4 * red + 260, red + 256].flatMap((value) => [value >> 8, value & 255])
    ]),
    chunk("IEND", [])
  ];
  const bytes = new Uint8Array(chunks.reduce((n, item) => n + item.length, 0));
  let offset = 0;
  for (const item of chunks) {
    bytes.set(item, offset);
    offset += item.length;
  }
  return bytes;
}
export const replacementBinary = (bytes: Uint8Array = replacementPng(89)) => ({
  kind: "bytes" as const,
  base64: btoa(String.fromCharCode(...bytes))
});
export async function replacementFixture(copies = 2) {
  const volume = Volume.fromJSON({ "/out": "" });
  await insertDocumentImage(
    await initialFixture(),
    {
      operation: "images.add",
      options: {
        file: replacementBinary(replacementPng()),
        output: "-",
        alt: "Preserved description",
        width: { value: 2, unit: "in" },
        height: { value: 1, unit: "in" }
      }
    },
    {
      ...replacementContext,
      stdout: {
        async write(bytes) {
          volume.appendFileSync("/out", bytes);
        }
      }
    }
  );
  const original = await readDocumentArchive(
      new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      textContext
    ),
    archive = { ...original, members: original.members.map((member) => ({ ...member })) },
    member = archive.members.find((item) => item.name === "word/document.xml")!;
  const xml = new TextDecoder().decode(member.bytes),
    start = xml.indexOf("<wi:r "),
    end = xml.indexOf("</wi:r>", start) + 7,
    draw = xml.slice(start, end);
  member.bytes = new TextEncoder().encode(
    xml.slice(0, end) +
      Array.from({ length: copies - 1 }, (_, n) => draw.replace('id="1"', `id="${n + 2}"`)).join(
        ""
      ) +
      xml.slice(end)
  );
  volume.writeFileSync("/out", "");
  await writeArchive(
    archive,
    {
      async write(bytes) {
        volume.appendFileSync("/out", bytes);
      }
    },
    { order: "input", compression: "store" },
    textContext
  );
  return new Uint8Array(volume.readFileSync("/out") as Uint8Array);
}
export async function rewriteReplacementFixture(
  input: Uint8Array,
  change: (files: Map<string, Uint8Array>) => void
) {
  const archive = await readDocumentArchive(input, textContext),
    files = new Map(archive.members.map((member) => [member.name, new Uint8Array(member.bytes)]));
  change(files);
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive(
    {
      ...archive,
      members: [...files].map(([name, bytes]) => ({
        name,
        bytes,
        directory: false,
        modified: new Date("2025-01-02T03:04:06Z")
      }))
    },
    {
      async write(bytes) {
        volume.appendFileSync("/out", bytes);
      }
    },
    { order: "input", compression: "store" },
    textContext
  );
  return new Uint8Array(volume.readFileSync("/out") as Uint8Array);
}
