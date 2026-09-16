import { documentDialects } from "./dialect.js";
import { xmlValue } from "./create-content.js";

/** Shared validated inline picture markup for operation and live-model insertion. */
export function inlineImageRun(
  ns: (typeof documentDialects)[keyof typeof documentDialects],
  drawingId: number,
  relationshipId: string,
  size: { width: number; height: number; crop: string },
  options: { alt?: string; decorative?: boolean | undefined; vectorRelationshipId?: string } = {}
): { prefix: string; suffix: string; run: string } {
  const decorative = options.decorative
    ? '<di:extLst><di:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><ad:decorative xmlns:ad="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></di:ext></di:extLst>'
    : "";
  const blip = options.vectorRelationshipId
    ? `<di:blip ri:embed="${relationshipId}"><di:extLst><di:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" xmlns:vr="${documentDialects.transitional.r}" vr:embed="${options.vectorRelationshipId}"/></di:ext></di:extLst></di:blip>`
    : `<di:blip ri:embed="${relationshipId}"/>`;
  const prefix = `<wi:r xmlns:wi="${ns.w}" xmlns:wp="${ns.wp}" xmlns:di="${ns.a}" xmlns:pic="${ns.pic}" xmlns:ri="${ns.r}"><wi:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${size.width}" cy="${size.height}"/><wp:docPr id="${drawingId}" name="Image ${drawingId}" descr="`;
  const suffix = `">${decorative}</wp:docPr><wp:cNvGraphicFramePr><di:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><di:graphic><di:graphicData uri="${ns.pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image ${drawingId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>${blip}${size.crop.split(documentDialects.transitional.a).join(ns.a)}<di:stretch><di:fillRect/></di:stretch></pic:blipFill><pic:spPr><di:xfrm><di:off x="0" y="0"/><di:ext cx="${size.width}" cy="${size.height}"/></di:xfrm><di:prstGeom prst="rect"><di:avLst/></di:prstGeom></pic:spPr></pic:pic></di:graphicData></di:graphic></wp:inline></wi:drawing></wi:r>`;
  return {
    prefix,
    suffix,
    get run() {
      return prefix + xmlValue(options.alt ?? "") + suffix;
    }
  };
}
