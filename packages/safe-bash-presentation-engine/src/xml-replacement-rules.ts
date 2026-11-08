export const xmlReplacementSequences: Readonly<Record<string, readonly string[]>> = {
  presentation: [
    "sldMasterIdLst",
    "notesMasterIdLst",
    "handoutMasterIdLst",
    "sldIdLst",
    "sldSz",
    "notesSz",
    "smartTags",
    "embeddedFontLst",
    "custShowLst",
    "photoAlbum",
    "custDataLst",
    "kinsoku",
    "defaultTextStyle",
    "modifyVerifier",
    "extLst"
  ],
  sld: ["cSld", "clrMapOvr", "transition", "timing", "extLst"],
  cSld: ["bg", "spTree", "custDataLst", "controls", "extLst"],
  nvGrpSpPr: ["cNvPr", "cNvGrpSpPr", "nvPr"],
  sp: ["nvSpPr", "spPr", "style", "txBody", "extLst"],
  pic: ["nvPicPr", "blipFill", "spPr", "style", "extLst"],
  graphicFrame: ["nvGraphicFramePr", "xfrm", "graphic", "extLst"]
};
