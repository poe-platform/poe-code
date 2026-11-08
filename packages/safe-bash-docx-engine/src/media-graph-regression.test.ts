import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createHash } from "node:crypto";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import {
  extractDocumentImages,
  inspectDocumentImages,
  insertDocumentImage,
  readDocumentArchive,
  replaceDocumentImage,
  setDocumentImageLayout
} from "./index.js";
import { layoutContext, layoutFixture } from "../tests/fixtures/image-layout.js";
import { replacementBinary, replacementPng } from "../tests/fixtures/image-replacement.js";
import { svgBinary, svgPairFixture } from "../tests/fixtures/svg-image.js";
import { inertMediaFixture } from "../tests/fixtures/inert-media.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it.each(["emf", "emf-bitmap"] as const)(
  "uses an authored complete %s record graph for preservation reduction",
  async (format) => {
    const archive = await readDocumentArchive(await inertMediaFixture(format), layoutContext);
    const bytes = archive.members.find((member) => member.name === "word/media/pixel.png")!.bytes;
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(header.getUint32(4, true)).toBe(88);
    expect(header.getUint32(48, true)).toBe(bytes.length);
    let offset = 0,
      records = 0;
    while (offset < bytes.length) {
      const size = header.getUint32(offset + 4, true);
      expect(size).toBeGreaterThanOrEqual(8);
      offset += size;
      records++;
    }
    expect(offset).toBe(bytes.length);
    expect(records).toBe(header.getUint32(52, true));
    expect(header.getUint32(bytes.length - 20, true)).toBe(14);
  }
);

it.each([false, true])(
  "keeps occurrence ownership through replacement and later crop edits (%s)",
  async (shared) => {
    const input = await layoutFixture({ copies: 2 }),
      volume = Volume.fromJSON({ "/replacement": "", "/layout": "" });
    await replaceDocumentImage(
      input,
      {
        operation: "images.replace",
        options: { image: 1, file: replacementBinary(), shared, output: "-" }
      },
      {
        ...layoutContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/replacement", bytes);
          }
        }
      }
    );
    const replaced = new Uint8Array(volume.readFileSync("/replacement") as Uint8Array);
    await expect(
      setDocumentImageLayout(
        replaced,
        { operation: "images.set", options: { image: 1, wrap: "top-bottom", output: "-" } },
        {
          ...layoutContext,
          stdout: {
            async write(bytes) {
              volume.appendFileSync("/layout", bytes);
            }
          }
        }
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(volume.readFileSync("/layout").length).toBe(0);
    await setDocumentImageLayout(
      replaced,
      {
        operation: "images.set",
        options: {
          image: 1,
          width: { value: 1, unit: "in" },
          cropLeft: 0.1,
          wrap: "top-bottom",
          distanceLeft: { value: 70, unit: "emu" },
          alt: "Technical sample",
          output: "-"
        }
      },
      {
        ...layoutContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/layout", bytes);
          }
        }
      }
    );
    const output = new Uint8Array(volume.readFileSync("/layout") as Uint8Array);
    const items = (await inspectDocumentImages(output, { operation: "images.list" }, layoutContext))
      .items!;
    expect(items[0]!.details).toMatchObject({
      sha256: hash(replacementPng(89)),
      widthEmu: 914400,
      heightEmu: 457200,
      crop: { left: 0.1, right: 0.02, top: 0.03, bottom: 0.04 },
      wrap: "top-bottom",
      alt: "Technical sample"
    });
    expect(items[1]!.details).toMatchObject({
      sha256: hash(shared ? replacementPng(89) : replacementPng()),
      widthEmu: 1828800,
      heightEmu: 914400,
      alt: "Stored alt"
    });
    const before = await readDocumentArchive(replaced, layoutContext),
      after = await readDocumentArchive(output, layoutContext);
    for (const member of before.members.filter((member) => member.name !== "word/document.xml"))
      expect(after.members.find((value) => value.name === member.name)?.bytes).toEqual(
        member.bytes
      );
  }
);

it("extracts repeated occurrences with exact bytes and a self-consistent manifest", async () => {
  const input = await layoutFixture({ copies: 2 }),
    filesystem = createMemoryFileSystem();
  await filesystem.mkdir("/media");
  const result = await extractDocumentImages(
    input,
    { outputDir: "/media", allowPartialOutput: true },
    { ...layoutContext, filesystem }
  );
  expect(result.complete).toBe(true);
  expect(result.entries).toHaveLength(2);
  expect(new Set(result.entries.map((entry) => entry.part)).size).toBe(1);
  for (const entry of result.entries) {
    const bytes = await filesystem.readFile(entry.path);
    expect(bytes).toEqual(replacementPng());
    expect(hash(bytes)).toBe(entry.sha256);
  }
  const manifest = await filesystem.readFile(result.manifest.path);
  expect(hash(manifest)).toBe(result.manifest.sha256);
  expect(JSON.parse(new TextDecoder().decode(manifest)).entries).toHaveLength(2);
});

it.each(["emf", "emf-bitmap", "wdp", "svg-pair"] as const)(
  "preserves inert %s resources through inline insertion and refuses their replacement before acquisition",
  async (format) => {
    const input = format === "svg-pair" ? await svgPairFixture() : await inertMediaFixture(format);
    const before = await readDocumentArchive(input, layoutContext),
      volume = Volume.fromJSON({ "/out": "" });
    await insertDocumentImage(
      input,
      {
        operation: "images.add",
        options: {
          paragraph: 1,
          file: svgBinary(replacementPng()),
          width: { value: 1, unit: "in" },
          height: { value: 0.5, unit: "in" },
          alt: "Technical marker",
          output: "-"
        }
      },
      {
        ...layoutContext,
        stdout: {
          async write(bytes) {
            volume.appendFileSync("/out", bytes);
          }
        }
      }
    );
    const output = new Uint8Array(volume.readFileSync("/out") as Uint8Array),
      after = await readDocumentArchive(output, layoutContext);
    for (const member of before.members.filter((member) => member.name.startsWith("word/media/")))
      expect(after.members.find((value) => value.name === member.name)?.bytes).toEqual(
        member.bytes
      );
    const items = (await inspectDocumentImages(output, { operation: "images.list" }, layoutContext))
      .items!;
    expect(items.at(-1)!.details).toMatchObject({
      placement: "inline",
      widthEmu: 914400,
      heightEmu: 457200,
      alt: "Technical marker"
    });
    let reads = 0,
      writes = 0;
    await expect(
      replaceDocumentImage(
        input,
        {
          operation: "images.replace",
          options: {
            image: 1,
            file: { kind: "vfs", capability: "blocked", path: "/marker.png" },
            output: "-"
          }
        },
        {
          ...layoutContext,
          binaryResolver: {
            capability: "blocked",
            async *open() {
              reads++;
              yield replacementPng();
            }
          },
          stdout: {
            async write() {
              writes++;
            }
          }
        }
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(reads).toBe(0);
    expect(writes).toBe(0);
  }
);
