import { PROG_ID } from "./ole-enum.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { Presentation } from "./presentation-model.js";
import { createPresentation } from "./creation.js";
import { Length } from "./length.js";
import { Picture, Movie, GraphicFrame } from "./slide-model.js";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const gif = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0,
  0, 2, 2, 68, 1, 0, 59
]);
const clip = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
it("inserts inert assets through the shared engines and reopens live returned interfaces", async () => {
  const deck = await Presentation(await createPresentation({ slides: [{}] }, context), context);
  const shapes = deck.slides[0]!.shapes;
  const picture = await shapes.add_picture(gif, new Length(0), new Length(0));
  expect(picture).toBeInstanceOf(Picture);
  expect(picture.image.size).toEqual([1, 1]);
  const movie = await shapes.add_movie(
    clip,
    new Length(2),
    new Length(3),
    new Length(100),
    new Length(120),
    { poster_frame_image: gif, mime_type: "video/mp4" }
  );
  expect(movie).toBeInstanceOf(Movie);
  expect(movie.media_format.part.partname).toBe("/ppt/slides/slide1.xml");
  expect(movie.poster_frame!.blob).toEqual(gif);
  const payload = new Uint8Array([0, 17, 255, 3]);
  const frame = await shapes.add_ole_object(
    payload,
    "Neutral.Object",
    new Length(5),
    new Length(6),
    { icon_file: gif }
  );
  expect(frame.ole_format.blob).toEqual(payload);
  expect(frame.ole_format.part).toBe(frame.part);
  frame.ole_format.blob!.fill(0);
  expect(frame.ole_format.blob).toEqual(payload);
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck", await deck.save());
  const reopened = await Presentation(new Uint8Array(fs.readFileSync("/deck") as Buffer), context);
  expect(reopened.slides[0]!.shapes[1]).toBeInstanceOf(Movie);
  expect((reopened.slides[0]!.shapes[2] as GraphicFrame).ole_format.prog_id).toBe("Neutral.Object");
});
it("rejects ambient paths and missing explicit movie policy without mutation", async () => {
  const deck = await Presentation(await createPresentation({ slides: [{}] }, context), context);
  const shapes = deck.slides[0]!.shapes;
  await expect(
    shapes.add_picture("/host/picture" as never, new Length(0), new Length(0))
  ).rejects.toThrow();
  await expect(
    shapes.add_movie(
      clip,
      new Length(0),
      new Length(0),
      new Length(100),
      new Length(100),
      {} as never
    )
  ).rejects.toThrow();
  expect(shapes.length).toBe(0);
});
it("inserts picture and OLE children into their group ownership and recomputes extents", async () => {
  const deck = await Presentation(await createPresentation({ slides: [{}] }, context), context);
  const shapes = deck.slides[0]!.shapes;
  const group = shapes.add_group_shape();
  const picture = await group.shapes.add_picture(
    gif,
    new Length(7),
    new Length(8),
    new Length(30),
    new Length(40)
  );
  expect(group.shapes.length).toBe(1);
  expect(shapes.length).toBe(1);
  expect(picture.image.size).toEqual([1, 1]);
  expect(group.left?.emu).toBe(7);
  const frame = await group.shapes.add_ole_object(
    new Uint8Array([1]),
    "Neutral.Object",
    new Length(10),
    new Length(10),
    { icon_file: gif }
  );
  expect(group.shapes.length).toBe(2);
  expect(frame.ole_format.blob).toEqual(new Uint8Array([1]));
});

it("retains registered OLE application defaults through model insertion", async () => {
  const deck = await Presentation(await createPresentation({ slides: [{}] }, context), context);
  const frame = await deck.slides[0]!.shapes.add_ole_object(
    new Uint8Array([1, 2]),
    PROG_ID.DOCX,
    new Length(0),
    new Length(0),
    { icon_file: gif }
  );
  expect(frame.ole_format.prog_id).toBe(PROG_ID.DOCX.progId);
  expect(frame.width?.emu).toBe(PROG_ID.DOCX.width.emu);
  expect(frame.height?.emu).toBe(PROG_ID.DOCX.height.emu);
});
it("snapshots explicit poster bytes before asynchronous input admission", async () => {
  const deck = await Presentation(await createPresentation({ slides: [{}] }, context), context);
  const supplied = new Uint8Array(gif);
  const pending = deck.slides[0]!.shapes.add_movie(
    clip,
    new Length(0),
    new Length(0),
    new Length(100),
    new Length(100),
    { poster_frame_image: supplied, mime_type: "video/mp4" }
  );
  supplied.fill(0);
  expect((await pending).poster_frame!.blob).toEqual(gif);
});
