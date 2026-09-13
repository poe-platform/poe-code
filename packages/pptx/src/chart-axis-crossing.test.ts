import { expect, it } from "vitest";
import { Chart } from "./chart-model.js";
import { XL_AXIS_CROSSES } from "./chart-enums.js";
import { parseXmlPart } from "./xml.js";
import { SaxesParser } from "saxes";

function tags(markup: string) {
  const result: { name: string; namespace: string; value: string | null }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    result.push({ name: tag.local, namespace: tag.uri, value: tag.attributes.val?.value ?? null });
  });
  parser.write(markup).close();
  return result;
}

function fixture(peer: string, crossing: string, strict: boolean) {
  const namespace = strict
    ? "http://purl.oclc.org/ooxml/drawingml/chart"
    : "http://schemas.openxmlformats.org/drawingml/2006/chart";
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<c:chartSpace xmlns:c="${namespace}"><c:chart><c:plotArea><c:lineChart/>` +
        `<c:${peer}><c:axId val="83"/>${crossing}<c:extLst/></c:${peer}>` +
        `<c:valAx><c:axId val="61"/><c:crossAx val="83"/><c:crosses val="max"/></c:valAx>` +
        `</c:plotArea></c:chart></c:chartSpace>`
    ),
    { maxBytes: 8000, maxNodes: 100, maxDepth: 16 }
  );
  const model = new Chart(
    () => xml,
    (next) => {
      xml = next;
    }
  );
  return { axis: model.value_axis, markup: () => xml.markup(xml.root) };
}

for (const strict of [false, true]) {
  it.each([
    ["valAx", "", XL_AXIS_CROSSES.CUSTOM, null],
    ["catAx", '<c:crosses val="autoZero"/>', XL_AXIS_CROSSES.AUTOMATIC, null],
    ["valAx", '<c:crosses val="min"/>', XL_AXIS_CROSSES.MINIMUM, null],
    ["catAx", '<c:crossesAt val="2.4"/>', XL_AXIS_CROSSES.CUSTOM, 2.4],
    ["dateAx", '<c:crossesAt val="-1.2"/>', XL_AXIS_CROSSES.CUSTOM, -1.2],
    ["catAx", '<c:crosses val="max"/>', XL_AXIS_CROSSES.MAXIMUM, null],
    ["catAx", '<c:crosses val="min"/>', XL_AXIS_CROSSES.MINIMUM, null],
    ["catAx", '<c:crossesAt val="2.75"/>', XL_AXIS_CROSSES.CUSTOM, 2.75],
    ["catAx", '<c:crossesAt val="-1.5"/>', XL_AXIS_CROSSES.CUSTOM, -1.5]
  ] as const)(
    `reads crossing state without mutation strict=${strict} %s %s`,
    (peer, initial, mode, value) => {
      const f = fixture(peer, initial, strict),
        before = f.markup();
      expect(f.axis.crosses).toBe(mode);
      expect(f.axis.crosses_at).toBe(value);
      expect(f.markup()).toBe(before);
    }
  );

  it.each([
    ["valAx", '<c:crossesAt val="2.4"/>', XL_AXIS_CROSSES.AUTOMATIC, '<c:crosses val="autoZero"/>'],
    ["catAx", '<c:crosses val="autoZero"/>', XL_AXIS_CROSSES.MINIMUM, '<c:crosses val="min"/>'],
    ["valAx", '<c:crosses val="min"/>', XL_AXIS_CROSSES.CUSTOM, '<c:crossesAt val="0"/>'],
    ["catAx", '<c:crossesAt val="2.4"/>', XL_AXIS_CROSSES.CUSTOM, '<c:crossesAt val="2.4"/>'],
    ["dateAx", "", XL_AXIS_CROSSES.CUSTOM, '<c:crossesAt val="0"/>'],
    ["catAx", '<c:crossesAt val="-3.75"/>', XL_AXIS_CROSSES.MAXIMUM, '<c:crosses val="max"/>'],
    ["catAx", '<c:crosses val="autoZero"/>', XL_AXIS_CROSSES.MAXIMUM, '<c:crosses val="max"/>'],
    ["catAx", '<c:crosses val="max"/>', XL_AXIS_CROSSES.MINIMUM, '<c:crosses val="min"/>'],
    ["catAx", '<c:crosses val="min"/>', XL_AXIS_CROSSES.CUSTOM, '<c:crossesAt val="0"/>'],
    ["catAx", '<c:crossesAt val="2.75"/>', XL_AXIS_CROSSES.CUSTOM, '<c:crossesAt val="2.75"/>']
  ] as const)(
    `changes only the crossed axis mode strict=${strict} %s %s`,
    (peer, initial, mode, expected) => {
      const f = fixture(peer, initial, strict);
      f.axis.crosses = mode;
      expect(f.axis.crosses).toBe(mode);
      expect(tags(f.markup())).toEqual(tags(fixture(peer, expected, strict).markup()));
      expect(f.markup()).toContain(
        '<c:valAx><c:axId val="61"/><c:crossAx val="83"/><c:crosses val="max"/></c:valAx>'
      );
    }
  );

  it.each([
    ["valAx", "", 2.4],
    ["catAx", '<c:crosses val="min"/>', 1.5],
    ["dateAx", '<c:crossesAt val="2.4"/>', 1.5],
    ["catAx", '<c:crossesAt val="1.5"/>', null],
    ["catAx", '<c:crosses val="autoZero"/>', -42.42],
    ["dateAx", '<c:crosses val="max"/>', 0],
    ["catAx", '<c:crosses val="autoZero"/>', 2.75],
    ["catAx", '<c:crossesAt val="2.75"/>', -1.5],
    ["catAx", '<c:crossesAt val="-1.5"/>', null],
    ["catAx", '<c:crosses val="autoZero"/>', null]
  ] as const)(
    `replaces or clears a numeric crossing strict=${strict} %s %s`,
    (peer, initial, value) => {
      const f = fixture(peer, initial, strict);
      f.axis.crosses_at = value;
      expect(f.axis.crosses_at).toBe(value);
      expect(f.axis.crosses).toBe(XL_AXIS_CROSSES.CUSTOM);
      const expected = value === null ? "" : `<c:crossesAt val="${value}"/>`;
      expect(tags(f.markup())).toEqual(tags(fixture(peer, expected, strict).markup()));
    }
  );
}
