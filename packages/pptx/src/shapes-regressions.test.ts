import { PP_PLACEHOLDER_TYPE, PP_PLACEHOLDER } from "./shape-placeholder-types.js";
import { MSO_SHAPE_TYPE } from "./shape-types.js";
import { MSO_SHAPE } from "./shape-presets.js";
import { expect, it } from "vitest";
import {
  Shape,
  applyShapeUpdate,
  readShape,
  createShapeXml,
  MSO_AUTO_SHAPE_TYPE
} from "./shapes.js";
import { parseXmlPart } from "./xml.js";

const presentation = "http://schemas.openxmlformats.org/presentationml/2006/main";
const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
const parse = (text: string) =>
  parseXmlPart(new TextEncoder().encode(text), {
    maxBytes: 20000,
    maxNodes: 200,
    maxDepth: 20
  });
function fixture(namespace = presentation) {
  return parse(
    `<p:sp xmlns:p="${namespace}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="19" name="Cedar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr wrap="none" lIns="12700"><a:noAutofit/></a:bodyPr><a:lstStyle><a:lvl1pPr marL="25400"/></a:lstStyle><a:p><a:r><a:rPr b="1"/><a:t>Old</a:t></a:r></a:p></p:txBody><p:extLst/></p:sp>`
  );
}
it("retains body settings and list defaults when replacing shape text", () => {
  const xml = fixture();
  const result = applyShapeUpdate(xml, xml.root, { text: "Cedar\nBirch" });
  const body = result.root.children.find((node) => node.name.localName === "txBody")!;
  expect(result.markup(body.children[0]!)).toBe(
    '<a:bodyPr wrap="none" lIns="12700"><a:noAutofit/></a:bodyPr>'
  );
  expect(result.markup(body.children[1]!)).toBe(
    '<a:lstStyle><a:lvl1pPr marL="25400"/></a:lstStyle>'
  );
  expect(body.children.map((node) => node.name.localName)).toEqual([
    "bodyPr",
    "lstStyle",
    "p",
    "p"
  ]);
  expect(new Shape(result).text).toBe("Cedar\nBirch");
  expect(result.markup(body)).not.toContain('b="1"');
});
it("serializes soft breaks and escaped control characters through shape text", () => {
  const shape = new Shape(fixture());
  shape.text = "Café\v芽\nOak\u001b";
  expect(shape.text).toBe("Café\v芽\nOak_x001B_");
  expect(shape.xml.markup(shape.element)).toContain("<br/>");
});
it.each(["urn:foreign", "http://purl.oclc.org/ooxml/presentationml/main/fake"])(
  "rejects shape local names in unrelated namespace %s",
  (namespace) => {
    const xml = fixture(namespace);
    const before = xml.bytes();
    expect(() => readShape(xml.root)).toThrow();
    expect(() => new Shape(xml)).toThrow();
    expect(() => applyShapeUpdate(xml, xml.root, { name: "Changed" })).toThrow();
    expect(xml.bytes()).toEqual(before);
  }
);

it.each([
  ["sp", "nvSpPr", "spPr", "a:xfrm"],
  ["pic", "nvPicPr", "spPr", "a:xfrm"],
  ["cxnSp", "nvCxnSpPr", "spPr", "a:xfrm"],
  ["grpSp", "nvGrpSpPr", "grpSpPr", "a:xfrm"],
  ["graphicFrame", "nvGraphicFramePr", "", "p:xfrm"]
] as const)(
  "reads local identity and explicit or absent geometry on %s",
  (tag, nonvisual, properties, transform) => {
    const wrap = (geometry: string) =>
      parse(
        `<p:${tag} xmlns:p="${presentation}" xmlns:a="${drawing}"><p:${nonvisual}><p:cNvPr id="37" name="&amp; Forest"/></p:${nonvisual}>${properties ? `<p:${properties}>${geometry}</p:${properties}>` : geometry}</p:${tag}>`
      );
    const absent = wrap("");
    expect(readShape(absent.root)).toMatchObject({
      shapeId: 37,
      name: "& Forest",
      left: null,
      top: null,
      width: null,
      height: null
    });
    const empty = wrap(`<${transform}/>`);
    expect(readShape(empty.root)).toMatchObject({
      left: null,
      top: null,
      width: null,
      height: null
    });
    const explicit = wrap(
      `<${transform}><a:off x="123" y="456"/><a:ext cx="789" cy="1011"/></${transform}>`
    );
    expect(readShape(explicit.root)).toMatchObject({
      shapeId: 37,
      left: 123,
      top: 456,
      width: 789,
      height: 1011
    });
    const zero = wrap(`<${transform}><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></${transform}>`);
    expect(readShape(zero.root)).toMatchObject({ left: 0, top: 0, width: 0, height: 0 });
  }
);
it("distinguishes empty metadata from absent metadata and removes optional overrides", () => {
  const shape = new Shape(fixture());
  shape.name = "";
  shape.title = "";
  shape.description = "";
  expect(readShape(shape.element)).toMatchObject({
    shapeId: 19,
    name: "",
    title: "",
    description: ""
  });
  shape.title = null;
  shape.description = null;
  expect(readShape(shape.element)).toMatchObject({
    shapeId: 19,
    name: "",
    title: null,
    description: null
  });
  expect(() =>
    applyShapeUpdate(shape.xml, shape.element, { description: "One", altText: "Two" })
  ).toThrow();
  expect(Reflect.set(shape, "shape_id", 29)).toBe(false);
  expect(shape.shape_id).toBe(19);
});
it.each([
  ["", 0, 7, "horz", "full"],
  ['idx="0" type="title" orient="vert" sz="half"', 0, 1, "vert", "half"],
  ['idx="42" type="body" sz="quarter"', 42, 2, "horz", "quarter"],
  ['idx="4294967295" type="pic"', 4294967295, 18, "horz", "full"]
] as const)(
  "preserves placeholder keys and optional metadata %s",
  (attributes, idx, type, orient, sz) => {
    const xml = parse(
      `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="23" name="Field"/><p:cNvSpPr/><p:nvPr><p:ph ${attributes}/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
    );
    expect(new Shape(xml).placeholder_format).toEqual({ idx, type, orient, sz });
  }
);

const presetExpectations = [
  ["ACTION_BUTTON_BACK_OR_PREVIOUS", 129, "actionButtonBackPrevious"],
  ["ACTION_BUTTON_BEGINNING", 131, "actionButtonBeginning"],
  ["ACTION_BUTTON_CUSTOM", 125, "actionButtonBlank"],
  ["ACTION_BUTTON_DOCUMENT", 134, "actionButtonDocument"],
  ["ACTION_BUTTON_END", 132, "actionButtonEnd"],
  ["ACTION_BUTTON_FORWARD_OR_NEXT", 130, "actionButtonForwardNext"],
  ["ACTION_BUTTON_HELP", 127, "actionButtonHelp"],
  ["ACTION_BUTTON_HOME", 126, "actionButtonHome"],
  ["ACTION_BUTTON_INFORMATION", 128, "actionButtonInformation"],
  ["ACTION_BUTTON_MOVIE", 136, "actionButtonMovie"],
  ["ACTION_BUTTON_RETURN", 133, "actionButtonReturn"],
  ["ACTION_BUTTON_SOUND", 135, "actionButtonSound"],
  ["ARC", 25, "arc"],
  ["BALLOON", 137, "wedgeRoundRectCallout"],
  ["BENT_ARROW", 41, "bentArrow"],
  ["BENT_UP_ARROW", 44, "bentUpArrow"],
  ["BEVEL", 15, "bevel"],
  ["BLOCK_ARC", 20, "blockArc"],
  ["CAN", 13, "can"],
  ["CHART_PLUS", 182, "chartPlus"],
  ["CHART_STAR", 181, "chartStar"],
  ["CHART_X", 180, "chartX"],
  ["CHEVRON", 52, "chevron"],
  ["CHORD", 161, "chord"],
  ["CIRCULAR_ARROW", 60, "circularArrow"],
  ["CLOUD", 179, "cloud"],
  ["CLOUD_CALLOUT", 108, "cloudCallout"],
  ["CORNER", 162, "corner"],
  ["CORNER_TABS", 169, "cornerTabs"],
  ["CROSS", 11, "plus"],
  ["CUBE", 14, "cube"],
  ["CURVED_DOWN_ARROW", 48, "curvedDownArrow"],
  ["CURVED_DOWN_RIBBON", 100, "ellipseRibbon"],
  ["CURVED_LEFT_ARROW", 46, "curvedLeftArrow"],
  ["CURVED_RIGHT_ARROW", 45, "curvedRightArrow"],
  ["CURVED_UP_ARROW", 47, "curvedUpArrow"],
  ["CURVED_UP_RIBBON", 99, "ellipseRibbon2"],
  ["DECAGON", 144, "decagon"],
  ["DIAGONAL_STRIPE", 141, "diagStripe"],
  ["DIAMOND", 4, "diamond"],
  ["DODECAGON", 146, "dodecagon"],
  ["DONUT", 18, "donut"],
  ["DOUBLE_BRACE", 27, "bracePair"],
  ["DOUBLE_BRACKET", 26, "bracketPair"],
  ["DOUBLE_WAVE", 104, "doubleWave"],
  ["DOWN_ARROW", 36, "downArrow"],
  ["DOWN_ARROW_CALLOUT", 56, "downArrowCallout"],
  ["DOWN_RIBBON", 98, "ribbon"],
  ["EXPLOSION1", 89, "irregularSeal1"],
  ["EXPLOSION2", 90, "irregularSeal2"],
  ["FLOWCHART_ALTERNATE_PROCESS", 62, "flowChartAlternateProcess"],
  ["FLOWCHART_CARD", 75, "flowChartPunchedCard"],
  ["FLOWCHART_COLLATE", 79, "flowChartCollate"],
  ["FLOWCHART_CONNECTOR", 73, "flowChartConnector"],
  ["FLOWCHART_DATA", 64, "flowChartInputOutput"],
  ["FLOWCHART_DECISION", 63, "flowChartDecision"],
  ["FLOWCHART_DELAY", 84, "flowChartDelay"],
  ["FLOWCHART_DIRECT_ACCESS_STORAGE", 87, "flowChartMagneticDrum"],
  ["FLOWCHART_DISPLAY", 88, "flowChartDisplay"],
  ["FLOWCHART_DOCUMENT", 67, "flowChartDocument"],
  ["FLOWCHART_EXTRACT", 81, "flowChartExtract"],
  ["FLOWCHART_INTERNAL_STORAGE", 66, "flowChartInternalStorage"],
  ["FLOWCHART_MAGNETIC_DISK", 86, "flowChartMagneticDisk"],
  ["FLOWCHART_MANUAL_INPUT", 71, "flowChartManualInput"],
  ["FLOWCHART_MANUAL_OPERATION", 72, "flowChartManualOperation"],
  ["FLOWCHART_MERGE", 82, "flowChartMerge"],
  ["FLOWCHART_MULTIDOCUMENT", 68, "flowChartMultidocument"],
  ["FLOWCHART_OFFLINE_STORAGE", 139, "flowChartOfflineStorage"],
  ["FLOWCHART_OFFPAGE_CONNECTOR", 74, "flowChartOffpageConnector"],
  ["FLOWCHART_OR", 78, "flowChartOr"],
  ["FLOWCHART_PREDEFINED_PROCESS", 65, "flowChartPredefinedProcess"],
  ["FLOWCHART_PREPARATION", 70, "flowChartPreparation"],
  ["FLOWCHART_PROCESS", 61, "flowChartProcess"],
  ["FLOWCHART_PUNCHED_TAPE", 76, "flowChartPunchedTape"],
  ["FLOWCHART_SEQUENTIAL_ACCESS_STORAGE", 85, "flowChartMagneticTape"],
  ["FLOWCHART_SORT", 80, "flowChartSort"],
  ["FLOWCHART_STORED_DATA", 83, "flowChartOnlineStorage"],
  ["FLOWCHART_SUMMING_JUNCTION", 77, "flowChartSummingJunction"],
  ["FLOWCHART_TERMINATOR", 69, "flowChartTerminator"],
  ["FOLDED_CORNER", 16, "foldedCorner"],
  ["FRAME", 158, "frame"],
  ["FUNNEL", 174, "funnel"],
  ["GEAR_6", 172, "gear6"],
  ["GEAR_9", 173, "gear9"],
  ["HALF_FRAME", 159, "halfFrame"],
  ["HEART", 21, "heart"],
  ["HEPTAGON", 145, "heptagon"],
  ["HEXAGON", 10, "hexagon"],
  ["HORIZONTAL_SCROLL", 102, "horizontalScroll"],
  ["ISOSCELES_TRIANGLE", 7, "triangle"],
  ["LEFT_ARROW", 34, "leftArrow"],
  ["LEFT_ARROW_CALLOUT", 54, "leftArrowCallout"],
  ["LEFT_BRACE", 31, "leftBrace"],
  ["LEFT_BRACKET", 29, "leftBracket"],
  ["LEFT_CIRCULAR_ARROW", 176, "leftCircularArrow"],
  ["LEFT_RIGHT_ARROW", 37, "leftRightArrow"],
  ["LEFT_RIGHT_ARROW_CALLOUT", 57, "leftRightArrowCallout"],
  ["LEFT_RIGHT_CIRCULAR_ARROW", 177, "leftRightCircularArrow"],
  ["LEFT_RIGHT_RIBBON", 140, "leftRightRibbon"],
  ["LEFT_RIGHT_UP_ARROW", 40, "leftRightUpArrow"],
  ["LEFT_UP_ARROW", 43, "leftUpArrow"],
  ["LIGHTNING_BOLT", 22, "lightningBolt"],
  ["LINE_CALLOUT_1", 109, "borderCallout1"],
  ["LINE_CALLOUT_1_ACCENT_BAR", 113, "accentCallout1"],
  ["LINE_CALLOUT_1_BORDER_AND_ACCENT_BAR", 121, "accentBorderCallout1"],
  ["LINE_CALLOUT_1_NO_BORDER", 117, "callout1"],
  ["LINE_CALLOUT_2", 110, "borderCallout2"],
  ["LINE_CALLOUT_2_ACCENT_BAR", 114, "accentCallout2"],
  ["LINE_CALLOUT_2_BORDER_AND_ACCENT_BAR", 122, "accentBorderCallout2"],
  ["LINE_CALLOUT_2_NO_BORDER", 118, "callout2"],
  ["LINE_CALLOUT_3", 111, "borderCallout3"],
  ["LINE_CALLOUT_3_ACCENT_BAR", 115, "accentCallout3"],
  ["LINE_CALLOUT_3_BORDER_AND_ACCENT_BAR", 123, "accentBorderCallout3"],
  ["LINE_CALLOUT_3_NO_BORDER", 119, "callout3"],
  ["LINE_CALLOUT_4", 112, "borderCallout3"],
  ["LINE_CALLOUT_4_ACCENT_BAR", 116, "accentCallout3"],
  ["LINE_CALLOUT_4_BORDER_AND_ACCENT_BAR", 124, "accentBorderCallout3"],
  ["LINE_CALLOUT_4_NO_BORDER", 120, "callout3"],
  ["LINE_INVERSE", 183, "lineInv"],
  ["MATH_DIVIDE", 166, "mathDivide"],
  ["MATH_EQUAL", 167, "mathEqual"],
  ["MATH_MINUS", 164, "mathMinus"],
  ["MATH_MULTIPLY", 165, "mathMultiply"],
  ["MATH_NOT_EQUAL", 168, "mathNotEqual"],
  ["MATH_PLUS", 163, "mathPlus"],
  ["MOON", 24, "moon"],
  ["NON_ISOSCELES_TRAPEZOID", 143, "nonIsoscelesTrapezoid"],
  ["NOTCHED_RIGHT_ARROW", 50, "notchedRightArrow"],
  ["NO_SYMBOL", 19, "noSmoking"],
  ["OCTAGON", 6, "octagon"],
  ["OVAL", 9, "ellipse"],
  ["OVAL_CALLOUT", 107, "wedgeEllipseCallout"],
  ["PARALLELOGRAM", 2, "parallelogram"],
  ["PENTAGON", 51, "homePlate"],
  ["PIE", 142, "pie"],
  ["PIE_WEDGE", 175, "pieWedge"],
  ["PLAQUE", 28, "plaque"],
  ["PLAQUE_TABS", 171, "plaqueTabs"],
  ["QUAD_ARROW", 39, "quadArrow"],
  ["QUAD_ARROW_CALLOUT", 59, "quadArrowCallout"],
  ["RECTANGLE", 1, "rect"],
  ["RECTANGULAR_CALLOUT", 105, "wedgeRectCallout"],
  ["REGULAR_PENTAGON", 12, "pentagon"],
  ["RIGHT_ARROW", 33, "rightArrow"],
  ["RIGHT_ARROW_CALLOUT", 53, "rightArrowCallout"],
  ["RIGHT_BRACE", 32, "rightBrace"],
  ["RIGHT_BRACKET", 30, "rightBracket"],
  ["RIGHT_TRIANGLE", 8, "rtTriangle"],
  ["ROUNDED_RECTANGLE", 5, "roundRect"],
  ["ROUNDED_RECTANGULAR_CALLOUT", 106, "wedgeRoundRectCallout"],
  ["ROUND_1_RECTANGLE", 151, "round1Rect"],
  ["ROUND_2_DIAG_RECTANGLE", 153, "round2DiagRect"],
  ["ROUND_2_SAME_RECTANGLE", 152, "round2SameRect"],
  ["SMILEY_FACE", 17, "smileyFace"],
  ["SNIP_1_RECTANGLE", 155, "snip1Rect"],
  ["SNIP_2_DIAG_RECTANGLE", 157, "snip2DiagRect"],
  ["SNIP_2_SAME_RECTANGLE", 156, "snip2SameRect"],
  ["SNIP_ROUND_RECTANGLE", 154, "snipRoundRect"],
  ["SQUARE_TABS", 170, "squareTabs"],
  ["STAR_10_POINT", 149, "star10"],
  ["STAR_12_POINT", 150, "star12"],
  ["STAR_16_POINT", 94, "star16"],
  ["STAR_24_POINT", 95, "star24"],
  ["STAR_32_POINT", 96, "star32"],
  ["STAR_4_POINT", 91, "star4"],
  ["STAR_5_POINT", 92, "star5"],
  ["STAR_6_POINT", 147, "star6"],
  ["STAR_7_POINT", 148, "star7"],
  ["STAR_8_POINT", 93, "star8"],
  ["STRIPED_RIGHT_ARROW", 49, "stripedRightArrow"],
  ["SUN", 23, "sun"],
  ["SWOOSH_ARROW", 178, "swooshArrow"],
  ["TEAR", 160, "teardrop"],
  ["TRAPEZOID", 3, "trapezoid"],
  ["UP_ARROW", 35, "upArrow"],
  ["UP_ARROW_CALLOUT", 55, "upArrowCallout"],
  ["UP_DOWN_ARROW", 38, "upDownArrow"],
  ["UP_DOWN_ARROW_CALLOUT", 58, "upDownArrowCallout"],
  ["UP_RIBBON", 97, "ribbon2"],
  ["U_TURN_ARROW", 42, "uturnArrow"],
  ["VERTICAL_SCROLL", 101, "verticalScroll"],
  ["WAVE", 103, "wave"]
] as const;
it.each(presetExpectations)(
  "serializes the documented preset %s with its independent numeric and XML values",
  (name, numeric, token) => {
    expect(MSO_AUTO_SHAPE_TYPE[name]).toBe(numeric);
    expect(MSO_AUTO_SHAPE_TYPE.to_xml(numeric)).toBe(token);
    const canonical: Readonly<Record<string, number>> = {
      accentBorderCallout3: 123,
      accentCallout3: 115,
      borderCallout3: 111,
      callout3: 119,
      wedgeRoundRectCallout: 137
    };
    expect(MSO_AUTO_SHAPE_TYPE.from_xml(token)).toBe(canonical[token] ?? numeric);
    const xml = parse(
      createShapeXml(numeric, 2, {
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 12700, unit: "emu" },
        height: { value: 25400, unit: "emu" }
      })
    );
    const properties = xml.root.children.find((node) => node.name.localName === "spPr")!;
    const geometry = properties.children.find((node) => node.name.localName === "prstGeom")!;
    expect(geometry.attributes).toEqual([
      { name: { namespace: "", localName: "prst" }, value: token }
    ]);
    expect(new Shape(xml).auto_shape_type).toBe(canonical[token] ?? numeric);
  }
);

it("fits a retained text handle using current shape dimensions in points", async () => {
  const { admitFontMetrics } = await import("./font-metrics.js");
  const shape = new Shape(
    parse(
      createShapeXml("text-box", 2, {
        left: { value: 0, unit: "pt" },
        top: { value: 0, unit: "pt" },
        width: { value: 20, unit: "pt" },
        height: { value: 50, unit: "pt" },
        text: "AA"
      })
    )
  );
  const frame = shape.text_frame;
  const metrics = admitFontMetrics({
    family: "Cedar",
    bold: false,
    italic: false,
    unitsPerEm: 10,
    lineHeight: 10,
    advances: { A: 10 }
  });
  const options = { marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, wrap: false };
  frame.fit_text("Cedar", 30, false, false, metrics, options);
  expect(frame.xml.markup(frame.xml.root)).toContain('sz="1000"');
  const { Pt } = await import("./length.js");
  shape.width = new Pt(40);
  frame.fit_text("Cedar", 30, false, false, metrics, options);
  expect(frame.xml.markup(frame.xml.root)).toContain('sz="2000"');
  expect(shape.xml.markup(shape.element)).toContain('sz="2000"');
});

it("escapes names and alternative text while retaining literal metadata values", () => {
  const shape = new Shape(fixture());
  shape.name = 'Pine & "Birch" <枝>';
  shape.title = '"Tree" & leaf';
  shape.description = 'Canopy <wide> & "green"';
  const record = readShape(shape.element);
  expect(record.name).toBe('Pine & "Birch" <枝>');
  expect(record.title).toBe('"Tree" & leaf');
  expect(record.description).toBe('Canopy <wide> & "green"');
  const markup = shape.xml.markup(shape.element);
  expect(markup).toContain('name="Pine &amp; &quot;Birch&quot; &lt;枝>"');
  expect(markup).toContain('title="&quot;Tree&quot; &amp; leaf"');
});
it.each([
  ["", '<a:prstGeom prst="rect"/>', 1, 1],
  ['txBox="1"', '<a:prstGeom prst="rect"/>', 17, null],
  ['txBox="true"', '<a:prstGeom prst="rect"/>', 17, null],
  ['txBox="false"', '<a:prstGeom prst="ellipse"/>', 1, 9],
  ["", "<a:custGeom/>", 5, null]
] as const)("classifies primitive shapes independently %s %s", (flags, geometry, type, preset) => {
  const xml = parse(
    `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="29" name="Branch"/><p:cNvSpPr ${flags}/><p:nvPr/></p:nvSpPr><p:spPr>${geometry}</p:spPr></p:sp>`
  );
  const shape = new Shape(xml);
  expect(shape.shape_type).toBe(type);
  if (preset === null) expect(() => shape.auto_shape_type).toThrow();
  else expect(shape.auto_shape_type).toBe(preset);
  expect(shape.has_text_frame).toBe(true);
  expect(shape.has_chart).toBe(false);
  expect(shape.has_table).toBe(false);
  expect(shape.fill.type).toBeNull();
  expect(shape.line.width.emu).toBe(0);
});
it("creates an empty text body in schema order and exposes a live text frame", () => {
  const xml = parse(
    `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="31" name="Spruce"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:extLst/></p:sp>`
  );
  const shape = new Shape(xml);
  expect(() => shape.shape_type).toThrow();
  const frame = shape.text_frame;
  expect(frame.text).toBe("");
  expect(shape.element.children.map((node) => node.name.localName)).toEqual([
    "nvSpPr",
    "spPr",
    "txBody",
    "extLst"
  ]);
  expect(frame.xml.root.children.map((node) => node.name.localName)).toEqual([
    "bodyPr",
    "lstStyle",
    "p"
  ]);
  frame.text = "Fir";
  expect(shape.text).toBe("Fir");
});

it.each([
  [null, null],
  [null, 12700],
  [12700, 12700],
  [12700, 25400],
  [25400, null]
] as const)(
  "assigns line width from %s to %s while retaining absent XML",
  async (initial, assigned) => {
    const { Length } = await import("./length.js");
    const xml = parse(
      `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="41" name="Alder"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:ln${initial === null ? "" : ` w="${initial}"`}/></p:spPr></p:sp>`
    );
    const shape = new Shape(xml);
    expect(shape.line.width.emu).toBe(initial ?? 0);
    shape.line.width = (assigned === null ? null : new Length(assigned)) as never;
    expect(shape.line.width.emu).toBe(assigned ?? 0);
    expect(readShape(shape.element).lineWidth).toBe(assigned);
  }
);

it.each(["", "blipFill", "gradFill", "grpFill", "noFill", "pattFill", "solidFill"])(
  "selects solid fill without synthesizing a color from %s",
  (kind) => {
    const xml = parse(
      `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="43" name="Maple"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${kind ? `<a:${kind}/>` : ""}</p:spPr></p:sp>`
    );
    const shape = new Shape(xml);
    shape.fill.solid();
    expect(shape.fill.type).toBe(1);
    expect(shape.fill.fore_color.type).toBeNull();
    expect(() => shape.fill.fore_color.rgb).toThrow();
    const properties = shape.element.children.find((node) => node.name.localName === "spPr")!;
    expect(properties.children.map((node) => node.name.localName)).toEqual(["solidFill"]);
    expect(properties.children[0]!.children).toEqual([]);
  }
);
it.each(["", "noFill", "solidFill"])(
  "accesses line color without inventing RGB from %s",
  (kind) => {
    const xml = parse(
      `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="47" name="Elm"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:ln>${kind ? `<a:${kind}/>` : ""}</a:ln></p:spPr></p:sp>`
    );
    const shape = new Shape(xml);
    const color = shape.line.color;
    expect(color.type).toBeNull();
    expect(() => color.rgb).toThrow();
    expect(readShape(shape.element)).toMatchObject({ lineFillType: "solidFill", lineColor: null });
  }
);

it.each(["", "blipFill", "gradFill", "grpFill", "noFill", "pattFill", "solidFill"])(
  "selects no fill while preserving sibling properties from %s",
  (kind) => {
    const xml = parse(
      `<p:sp xmlns:p="${presentation}" xmlns:a="${drawing}"><p:nvSpPr><p:cNvPr id="53" name="Willow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"/>${kind ? `<a:${kind}/>` : ""}<a:ln w="12700"/><a:effectLst/></p:spPr></p:sp>`
    );
    const shape = new Shape(xml);
    shape.fill.background();
    expect(shape.fill.type).toBe(5);
    expect(() => shape.fill.fore_color).toThrow();
    expect(readShape(shape.element)).toMatchObject({
      fill: null,
      fillType: "noFill",
      lineWidth: 12700
    });
    const properties = shape.element.children.find((node) => node.name.localName === "spPr")!;
    expect(properties.children.map((node) => node.name.localName)).toEqual([
      "prstGeom",
      "noFill",
      "ln",
      "effectLst"
    ]);
  }
);

const placeholderExpectations = [
  ["BITMAP", 9, "clipArt"],
  ["BODY", 2, "body"],
  ["CENTER_TITLE", 3, "ctrTitle"],
  ["CHART", 8, "chart"],
  ["DATE", 16, "dt"],
  ["FOOTER", 15, "ftr"],
  ["HEADER", 14, "hdr"],
  ["MEDIA_CLIP", 10, "media"],
  ["MIXED", -2, null],
  ["OBJECT", 7, "obj"],
  ["ORG_CHART", 11, "dgm"],
  ["PICTURE", 18, "pic"],
  ["SLIDE_IMAGE", 101, "sldImg"],
  ["SLIDE_NUMBER", 13, "sldNum"],
  ["SUBTITLE", 4, "subTitle"],
  ["TABLE", 12, "tbl"],
  ["TITLE", 1, "title"],
  ["VERTICAL_BODY", 6, null],
  ["VERTICAL_OBJECT", 17, null],
  ["VERTICAL_TITLE", 5, null]
] as const;

const categoryExpectations = [
  ["AUTO_SHAPE", 1],
  ["CALLOUT", 2],
  ["CANVAS", 20],
  ["CHART", 3],
  ["COMMENT", 4],
  ["DIAGRAM", 21],
  ["EMBEDDED_OLE_OBJECT", 7],
  ["FORM_CONTROL", 8],
  ["FREEFORM", 5],
  ["GROUP", 6],
  ["IGX_GRAPHIC", 24],
  ["INK", 22],
  ["INK_COMMENT", 23],
  ["LINE", 9],
  ["LINKED_OLE_OBJECT", 10],
  ["LINKED_PICTURE", 11],
  ["MEDIA", 16],
  ["MIXED", -2],
  ["OLE_CONTROL_OBJECT", 12],
  ["PICTURE", 13],
  ["PLACEHOLDER", 14],
  ["SCRIPT_ANCHOR", 18],
  ["TABLE", 19],
  ["TEXT_BOX", 17],
  ["TEXT_EFFECT", 15],
  ["WEB_VIDEO", 26]
] as const;
it.each(placeholderExpectations)(
  "exposes independent placeholder symbol %s",
  (name, value, token) => {
    expect(PP_PLACEHOLDER_TYPE[name]).toBe(value);
    expect(PP_PLACEHOLDER_TYPE.metadata(value)).toEqual({ name, value, xml_value: token });
    expect(Object.isFrozen(PP_PLACEHOLDER_TYPE.metadata(value))).toBe(true);
    if (token === null) {
      expect(() => PP_PLACEHOLDER_TYPE.to_xml(value)).toThrow();
      expect(() => PP_PLACEHOLDER_TYPE.validate(value)).toThrow();
    } else {
      expect(PP_PLACEHOLDER_TYPE.to_xml(value)).toBe(token);
      expect(PP_PLACEHOLDER_TYPE.from_xml(token)).toBe(value);
      expect(PP_PLACEHOLDER_TYPE.validate(value)).toBeUndefined();
    }
  }
);
it.each(categoryExpectations)("exposes independent shape category %s", (name, value) => {
  expect(MSO_SHAPE_TYPE[name]).toBe(value);
  expect(MSO_SHAPE_TYPE.metadata(value)).toEqual({ name, value });
  expect(Object.isFrozen(MSO_SHAPE_TYPE.metadata(value))).toBe(true);
});
it("retains enum aliases and rejects unknown helper arguments", () => {
  expect(MSO_SHAPE).toBe(MSO_AUTO_SHAPE_TYPE);
  expect(PP_PLACEHOLDER).toBe(PP_PLACEHOLDER_TYPE);
  expect(Object.isFrozen(PP_PLACEHOLDER_TYPE)).toBe(true);
  expect(Object.isFrozen(MSO_SHAPE_TYPE)).toBe(true);
  expect(() => MSO_AUTO_SHAPE_TYPE.metadata(999 as never)).toThrow();
  expect(() => MSO_AUTO_SHAPE_TYPE.validate(999 as never)).toThrow();
  expect(() => MSO_AUTO_SHAPE_TYPE.to_xml(999 as never)).toThrow();
  expect(() => PP_PLACEHOLDER_TYPE.metadata(999 as never)).toThrow();
  expect(() => PP_PLACEHOLDER_TYPE.from_xml("missing")).toThrow();
  expect(() => MSO_SHAPE_TYPE.metadata(999 as never)).toThrow();
});
