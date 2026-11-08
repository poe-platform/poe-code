export const drawingShapeSourceCases = [
  { row: 843, action: "predicate", container: "inline", payload: "pic", expected: false },
  { row: 844, action: "predicate", container: "anchor", payload: "pic", expected: false },
  { row: 845, action: "predicate", container: "inline", payload: "grpSp", expected: false },
  { row: 846, action: "predicate", container: "anchor", payload: "chart", expected: false },
  { row: 847, action: "image", container: "inline", payload: "embedded" },
  { row: 848, action: "image-reject", container: "inline", payload: "grpSp" },
  { row: 975, action: "count" }, { row: 976, action: "iter" }, { row: 977, action: "index" },
  { row: 978, action: "bounds", index: -3 }, { row: 978, action: "bounds", index: 2 },
  { row: 979, action: "owner" },
  { row: 980, action: "type", payload: "embedded", expected: "PICTURE" },
  { row: 981, action: "type", payload: "linked", expected: "LINKED_PICTURE" },
  { row: 982, action: "type", payload: "both", expected: "LINKED_PICTURE" },
  { row: 983, action: "type", payload: "chart", expected: "CHART" },
  { row: 984, action: "type", payload: "diagram", expected: "SMART_ART" },
  { row: 985, action: "type", payload: "foobar", expected: "NOT_IMPLEMENTED" },
  { row: 986, action: "dimensions" }, { row: 987, action: "set", payload: "sized" }
] as const;
export function drawingShapeSourceXml(c: typeof drawingShapeSourceCases[number], strict: boolean) {
  const base = strict ? "http://purl.oclc.org/ooxml/drawingml/" : "http://schemas.openxmlformats.org/drawingml/2006/";
  const ns = { wp: base + "wordprocessingDrawing", a: base + "main", pic: base + "picture" };
  let content: string;
  if (["count", "iter", "index", "bounds", "owner"].includes(c.action)) content = '<w:r><w:drawing><wp:inline/></w:drawing></w:r><w:r><w:drawing><wp:inline/></w:drawing></w:r>';
  else {
    const payload = "payload" in c ? c.payload : "none", container = "container" in c ? c.container : "inline";
    const pic = payload === "pic" ? '<pic:pic/>' : ["embedded", "linked", "both"].includes(payload) ? `<pic:pic><pic:blipFill><a:blip ${payload === "linked" ? 'r:link="rId2"' : payload === "both" ? 'r:embed="rId1" r:link="rId2"' : 'r:embed="rId1"'}/></pic:blipFill></pic:pic>` : payload === "sized" ? '<pic:pic><pic:spPr><a:xfrm><a:ext cx="333" cy="666"/></a:xfrm></pic:spPr></pic:pic>' : payload === "grpSp" || c.action === "predicate" ? `<a:${payload}/>` : '';
    const uri = payload === "chart" ? base + "chart" : payload === "diagram" ? base + "diagram" : payload === "foobar" ? "foobar" : ns.pic;
    const graphic = c.action === "dimensions" ? '' : `<a:graphic><a:graphicData${c.action === "type" ? ` uri="${uri}"` : ''}>${pic}</a:graphicData></a:graphic>`;
    content = `<w:r><w:drawing><wp:${container}>${["dimensions", "set"].includes(c.action) ? '<wp:extent cx="333" cy="666"/>' : ''}${graphic}</wp:${container}></w:drawing></w:r>`;
  }
  return { ns, paragraph: `<w:p xmlns:wp="${ns.wp}" xmlns:a="${ns.a}" xmlns:pic="${ns.pic}">${content}</w:p>`, embedded: "payload" in c && ["embedded", "both"].includes(c.payload), linked: "payload" in c && ["linked", "both"].includes(c.payload) };
}
