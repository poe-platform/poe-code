import { expect, it } from "vitest";
import { Volume } from "memfs";
import { SlideShapes, Movie, GraphicFrame, Picture } from "./slide-model.js";
import { parseXmlPart } from "./xml.js";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const gif = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0,
  0, 2, 2, 68, 1, 0, 59
]);
function fixture(body: string) {
  const fs = Volume.fromJSON({});
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    ),
    { maxBytes: 100000, maxNodes: 1000, maxDepth: 32 }
  );
  const owner = {
    read: () => xml,
    write: (next: typeof xml) => {
      xml = next;
      fs.writeFileSync("/slide", xml.bytes());
    },
    resource: () => ({
      blob: new Uint8Array(gif),
      content_type: "image/gif",
      partname: "/ppt/media/sample.gif"
    })
  };
  return new SlideShapes(owner);
}
const picture = (extra = "") =>
  `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Display"/><p:cNvPicPr/><p:nvPr>${extra}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm><a:off x="3" y="4"/><a:ext cx="10" cy="20"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic>`;
it("returns live movie, inherited picture properties and public media-format ownership", () => {
  const shapes = fixture(picture('<a:videoFile r:link="rId2"/>'));
  const movie = shapes.get(0) as Movie;
  expect(movie).toBeInstanceOf(Movie);
  expect(movie.media_type).toBe(3);
  expect(movie.shape_type).toBe(16);
  expect(movie.poster_frame!.blob).toEqual(gif);
  expect(movie.media_format.parent).toBe(movie);
  expect(movie.media_format.element.name.localName).toBe("pic");
  movie.crop_left = -0.25;
  expect((shapes.get(0) as Movie).crop_left).toBe(-0.25);
  expect(movie.left?.emu).toBe(3);
});
it("exposes isolated picture image snapshots", () => {
  const image = (fixture(picture()).get(0) as Picture).image;
  expect(image.content_type).toBe("image/gif");
  const blob = image.blob;
  blob.fill(0);
  expect(image.blob).toEqual(gif);
});
it("returns OLE bytes, icon flag and program identifier without activation", () => {
  const frame = fixture(
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Attachment"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData><p:oleObj r:id="rId3" progId="Neutral.Object" showAsIcon="1"><p:embed/></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`
  ).get(0) as GraphicFrame;
  expect(frame.shape_type).toBe(7);
  expect(frame.ole_format.prog_id).toBe("Neutral.Object");
  expect(frame.ole_format.show_as_icon).toBe(true);
  expect(frame.ole_format.blob).toEqual(gif);
  expect(frame.ole_format.parent).toBe(frame);
  expect(frame.ole_format.element.name.localName).toBe("graphicData");
});

it("preserves missing OLE values and refuses absent OLE interface", () => {
  const frame = fixture(
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Attachment"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData><p:oleObj><p:link/></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`
  ).get(0) as GraphicFrame;
  expect(frame.ole_format.prog_id).toBeNull();
  expect(frame.ole_format.show_as_icon).toBe(false);
  expect(frame.ole_format.blob).toBeNull();
  expect(frame.shape_type).toBe(10);
  expect(() => frame.ole_format.part).toThrow();
});
it("returns null for an absent movie poster and an absent OLE file relationship", () => {
  const movie = fixture(
    picture('<a:videoFile r:link="rId2"/>').replace('<a:blip r:embed="rId1"/>', "<a:blip/>")
  ).get(0) as Movie;
  expect(movie.poster_frame).toBeNull();
  const frame = fixture(
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Attachment"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData><p:oleObj><p:embed/></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`
  ).get(0) as GraphicFrame;
  expect(frame.ole_format.blob).toBeNull();
});
it("ignores foreign media lookalikes and retains inherited picture formatting", () => {
  const shapes = fixture(picture('<x:videoFile xmlns:x="urn:foreign" r:link="rId2"/>'));
  const shape = shapes.get(0) as Picture;
  expect(shape).not.toBeInstanceOf(Movie);
  expect(shape.line).toBeDefined();
  expect(shape.shadow).toBeDefined();
  shape.name = "Renamed";
  shape.rotation = 30;
  expect((shapes.get(0) as Picture).name).toBe("Renamed");
  expect(shape.rotation).toBe(30);
  shape.crop_bottom = 1.5;
  shape.crop_top = 0.25;
  shape.crop_right = -0.5;
  expect([shape.crop_bottom, shape.crop_top, shape.crop_right]).toEqual([1.5, 0.25, -0.5]);
});
