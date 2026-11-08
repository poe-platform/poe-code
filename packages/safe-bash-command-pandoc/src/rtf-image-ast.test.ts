import { expect, it, vi } from "vitest";
import { decodeJpegImage } from "@poe-code/image-ast";
import { writeDocument } from "./engine.js";
import type { Document } from "./types.js";

vi.mock("@poe-code/image-ast", async importOriginal => {
  const actual = await importOriginal<typeof import("@poe-code/image-ast")>();
  return { ...actual, decodeJpegImage: vi.fn(actual.decodeJpegImage) };
});

const segment = (marker: number, data: readonly number[]) =>
  [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
const bytes = Uint8Array.from([255, 216,
  ...segment(219, [0, ...Array<number>(64).fill(1)]),
  ...segment(192, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
  ...segment(196, [0, 1, ...Array<number>(15).fill(0), 0, 16, 1, ...Array<number>(15).fill(0), 0]),
  ...segment(218, [1, 1, 0, 0, 63, 0]), 0x3f, 255, 217]);
const document: Document = {
  blocks: [{ t: "Para", c: [{ t: "Image", c: [["", [], []], [], ["picture", ""]] }] }],
  metadata: {}, resources: [{ id: "picture", bytes }]
};

it("validates RTF JPEG resources through the shared image-ast decoder", async () => {
  vi.mocked(decodeJpegImage).mockClear();
  const output = await writeDocument(document, { to: "rtf" }, {});
  expect(output).toMatchObject({ kind: "text", text: expect.stringContaining("\\jpegblip\\picw1\\pich1") });
  expect(decodeJpegImage).toHaveBeenCalledExactlyOnceWith(bytes);
});

it("charges JPEG retained capacity before invoking the shared decoder", async () => {
  vi.mocked(decodeJpegImage).mockClear();
  await expect(writeDocument(document, { to: "rtf" }, { limits: { retainedBytes: 1 } })).rejects.toMatchObject({ code: "E_LIMIT" });
  expect(decodeJpegImage).not.toHaveBeenCalled();
});

it("reports shared decoder failures as resource errors without publishing", async () => {
  const publish = vi.fn(async () => {});
  vi.mocked(decodeJpegImage).mockImplementationOnce(() => { throw new Error("Invalid JPEG"); });
  try {
    await expect(writeDocument(document, { to: "rtf" }, { output: { publish } })).rejects.toMatchObject({ code: "E_RESOURCE" });
    expect(publish).not.toHaveBeenCalled();
  } finally { vi.mocked(decodeJpegImage).mockReset(); }
});
