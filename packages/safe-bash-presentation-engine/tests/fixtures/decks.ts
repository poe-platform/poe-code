import { Volume } from "memfs";

type DeckTheme = "seed-library" | "coastal-observatory" | "bicycle-workshop";
type DeckVariant =
  | "valid"
  | "missing-layout"
  | "dangling-image"
  | "duplicate-shape-id"
  | "dangling-timing-target"
  | "malformed-slide-xml";

const stories = {
  "seed-library": {
    title: "Seed library",
    body: "Borrow seeds. Grow a row. Return a handful.",
    categories: ["Beans", "Peas"],
    values: [12, 8],
    series: "Packets shared",
    pixels: [48, 96, 32, 80, 144, 64, 0, 0, 112, 176, 96, 160, 208, 144, 0, 0]
  },
  "coastal-observatory": {
    title: "Coastal observatory",
    body: "Read the tide. Log the wind. Share the watch.",
    categories: ["North", "South"],
    values: [3, 5],
    series: "Watches logged",
    pixels: [128, 64, 16, 176, 112, 32, 0, 0, 208, 160, 64, 240, 208, 128, 0, 0]
  },
  "bicycle-workshop": {
    title: "Bicycle repair workshop",
    body: "Patch a tube. True a wheel. Teach a neighbor.",
    categories: ["Tubes", "Wheels"],
    values: [7, 4],
    series: "Repairs completed",
    pixels: [32, 64, 144, 64, 112, 192, 0, 0, 96, 160, 224, 144, 208, 240, 0, 0]
  }
} as const;

const namespaces = {
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
};

function relationships(entries: readonly (readonly [string, string, string])[]): string {
  return `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
}

function textShape(
  id: number,
  name: string,
  text: string,
  x: number,
  y: number,
  cx: number,
  cy: number
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${text}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

function groupProperties(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  childCx: number,
  childCy: number
): string {
  return `<p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/><a:chOff x="0" y="0"/><a:chExt cx="${childCx}" cy="${childCy}"/></a:xfrm></p:grpSpPr>`;
}

function bitmap(pixels: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(70);
  const header = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  header.setUint32(2, 70, true);
  header.setUint32(10, 54, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, 2, true);
  header.setInt32(22, 2, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  header.setUint32(34, 16, true);
  bytes.set(pixels, 54);
  return bytes;
}

export function createDeckFixture(
  theme: DeckTheme,
  variant: DeckVariant = "valid"
): { volume: Volume; root: string } {
  const story = stories[theme];
  const root = "/deck";
  const drawingNamespaces = `xmlns:p="${namespaces.p}" xmlns:a="${namespaces.a}" xmlns:r="${namespaces.r}"`;
  const emptyTree = groupProperties(1, "", 0, 0, 0, 0, 0, 0);
  const colorMap =
    'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"';
  const slide = `<p:sld ${drawingNamespaces}><p:cSld name="${story.title}"><p:spTree>${emptyTree}
${textShape(2, "Title", story.title, 500000, 250000, 8000000, 750000)}
<p:grpSp>${groupProperties(3, "Activity group", 1000000, 1500000, 4000000, 2000000, 2000000, 1000000)}
<p:grpSp>${groupProperties(4, "Instruction group", 100000, 200000, 1000000, 500000, 1000000, 500000)}
${textShape(5, "Instructions", story.body, 0, 0, 1000000, 500000)}</p:grpSp></p:grpSp>
<p:pic><p:nvPicPr><p:cNvPr id="${variant === "duplicate-shape-id" ? 5 : 6}" name="Color tile" descr="An original four-color square"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="6000000" y="1500000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Activity chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="500000" y="4000000"/><a:ext cx="6000000" cy="2500000"/></p:xfrm><a:graphic><a:graphicData uri="${namespaces.c}"><c:chart xmlns:c="${namespaces.c}" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="4" dur="0" fill="hold"/><p:tgtEl><p:spTgt spid="${variant === "dangling-timing-target" ? 999 : 5}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>${variant === "malformed-slide-xml" ? "" : "</p:sld>"}`;
  const partTypes = [
    [
      "/ppt/presentation.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
    ],
    [
      "/ppt/slides/slide1.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
    ],
    [
      "/ppt/slideLayouts/slideLayout1.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"
    ],
    [
      "/ppt/slideMasters/slideMaster1.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"
    ],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/ppt/charts/chart1.xml", "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"]
  ];
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const lines =
    '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>'.repeat(
      3
    );
  const colors = [
    ["dk1", "102030"],
    ["lt1", "FFFFFF"],
    ["dk2", "304050"],
    ["lt2", "F0F4F0"],
    ["accent1", "408050"],
    ["accent2", "2070A0"],
    ["accent3", "D08030"],
    ["accent4", "805090"],
    ["accent5", "507080"],
    ["accent6", "C05050"],
    ["hlink", "0055AA"],
    ["folHlink", "663399"]
  ];
  const volume = Volume.fromJSON(
    {
      "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bmp" ContentType="image/bmp"/>${partTypes.map(([part, contentType]) => `<Override PartName="${part}" ContentType="${contentType}"/>`).join("")}</Types>`,
      "_rels/.rels": relationships([
        ["rId1", `${namespaces.r}/officeDocument`, "ppt/presentation.xml"],
        [
          "rId2",
          "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
          "docProps/core.xml"
        ]
      ]),
      "docProps/core.xml": `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${story.title}</dc:title><dc:creator>Community learning circle</dc:creator><dc:description>${story.body}</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`,
      "ppt/presentation.xml": `<p:presentation ${drawingNamespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": relationships([
        ["rId1", `${namespaces.r}/slideMaster`, "slideMasters/slideMaster1.xml"],
        ["rId2", `${namespaces.r}/slide`, "slides/slide1.xml"]
      ]),
      "ppt/slides/slide1.xml": slide,
      "ppt/slides/_rels/slide1.xml.rels": relationships([
        ["rId1", `${namespaces.r}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
        [
          "rId2",
          `${namespaces.r}/image`,
          variant === "dangling-image" ? "../media/missing.bmp" : "../media/tile.bmp"
        ],
        ["rId3", `${namespaces.r}/chart`, "../charts/chart1.xml"]
      ]),
      "ppt/slideLayouts/slideLayout1.xml": `<p:sldLayout ${drawingNamespaces} type="blank" preserve="1"><p:cSld name="Blank canvas"><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([
        ["rId1", `${namespaces.r}/slideMaster`, "../slideMasters/slideMaster1.xml"]
      ]),
      "ppt/slideMasters/slideMaster1.xml": `<p:sldMaster ${drawingNamespaces}><p:cSld name="Community master"><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMap ${colorMap}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([
        ["rId1", `${namespaces.r}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
        ["rId2", `${namespaces.r}/theme`, "../theme/theme1.xml"]
      ]),
      "ppt/theme/theme1.xml": `<a:theme xmlns:a="${namespaces.a}" name="Community colors"><a:themeElements><a:clrScheme name="Community colors">${colors.map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`).join("")}</a:clrScheme><a:fontScheme name="Community type"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Community styles"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lines}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
      "ppt/charts/chart1.xml": `<c:chartSpace xmlns:c="${namespaces.c}" xmlns:a="${namespaces.a}" xmlns:r="${namespaces.r}"><c:date1904 val="0"/><c:lang val="en-US"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${story.series}</c:v></c:tx><c:cat><c:strLit><c:ptCount val="2"/>${story.categories.map((category, index) => `<c:pt idx="${index}"><c:v>${category}</c:v></c:pt>`).join("")}</c:strLit></c:cat><c:val><c:numLit><c:formatCode>0</c:formatCode><c:ptCount val="2"/>${story.values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join("")}</c:numLit></c:val></c:ser><c:axId val="10"/><c:axId val="20"/></c:barChart><c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="0" sourceLinked="0"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`
    },
    root
  );
  volume.mkdirSync(`${root}/ppt/media`, { recursive: true });
  volume.writeFileSync(`${root}/ppt/media/tile.bmp`, bitmap(story.pixels));
  if (variant === "missing-layout") {
    volume.unlinkSync(`${root}/ppt/slideLayouts/slideLayout1.xml`);
  }
  return { volume, root };
}
