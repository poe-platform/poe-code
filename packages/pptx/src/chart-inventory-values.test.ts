import { expect, it } from "vitest";
import { inspectChart, type ChartXmlNode } from "./charts.js";
import { parseXmlPart } from "./xml.js";

function inventory(body: string) {
  return inspectChart(
    parseXmlPart(
      new TextEncoder().encode(
        `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart>${body}</c:chart></c:chartSpace>`
      ),
      { maxBytes: 65536, maxNodes: 2000, maxDepth: 24 }
    )
  );
}

it.each([
  ["catAx", "12.34", "-12.34"],
  ["dateAx", "42.24", "-42.24"],
  ["valAx", "23.45", "-23.45"]
])("retains %s explicit scale bounds without inferring absent bounds", (type, max, min) => {
  const result = inventory(
    `<c:plotArea><c:${type}><c:scaling><c:max val="${max}"/><c:min val="${min}"/></c:scaling></c:${type}></c:plotArea>`
  );
  expect(result.axes[0]!.details.children[0]!.children.map((node) => node.attributes)).toEqual([
    { val: max },
    { val: min }
  ]);
  expect(
    inventory(`<c:plotArea><c:${type}><c:scaling/></c:${type}></c:plotArea>`).axes[0]!.details
      .children[0]!.children
  ).toEqual([]);
});

it.each([
  ["catAx", "majorTickMark", "out"],
  ["dateAx", "majorTickMark", "out"],
  ["valAx", "majorTickMark", "in"],
  ["catAx", "minorTickMark", "out"],
  ["dateAx", "minorTickMark", "out"],
  ["valAx", "minorTickMark", "in"],
  ["catAx", "tickLblPos", "high"],
  ["dateAx", "tickLblPos", "low"],
  ["valAx", "tickLblPos", "none"]
])("distinguishes absent empty and explicit %s %s metadata", (type, field, value) => {
  const absent = inventory(`<c:plotArea><c:${type}/></c:plotArea>`).axes[0]!;
  const empty = inventory(`<c:plotArea><c:${type}><c:${field}/></c:${type}></c:plotArea>`).axes[0]!;
  const explicit = inventory(
    `<c:plotArea><c:${type}><c:${field} val="${value}"/></c:${type}></c:plotArea>`
  ).axes[0]!;
  expect(absent.details.children).toEqual([]);
  expect(empty.details.children[0]!.attributes).toEqual({});
  expect(explicit.properties[field]).toBe(value);
});

it.each(["minMax", "maxMin"])(
  "retains axis orientation %s without changing source order",
  (value) => {
    const result = inventory(
      `<c:plotArea><c:valAx><c:scaling><c:orientation val="${value}"/></c:scaling></c:valAx></c:plotArea>`
    );
    expect(result.axes[0]!.details.children[0]!.children[0]!.attributes).toEqual({ val: value });
  }
);

it.each(["catAx", "dateAx", "valAx"])(
  "records %s gridline presence and source-linked number format",
  (type) => {
    const result = inventory(
      `<c:plotArea><c:${type}><c:majorGridlines/><c:minorGridlines/><c:numFmt formatCode="00.00" sourceLinked="0"/></c:${type}></c:plotArea>`
    );
    expect(result.axes[0]!.details.children.map((node) => [node.name, node.attributes])).toEqual([
      ["majorGridlines", {}],
      ["minorGridlines", {}],
      ["numFmt", { formatCode: "00.00", sourceLinked: "0" }]
    ]);
  }
);

it.each(["showCatName", "showLegendKey", "showPercent", "showSerName", "showVal"])(
  "preserves every %s boolean spelling and absent distinction",
  (flag) => {
    for (const [markup, attributes] of [
      ["", null],
      [`<c:${flag}/>`, {}],
      [`<c:${flag} val="0"/>`, { val: "0" }],
      [`<c:${flag} val="1"/>`, { val: "1" }],
      [`<c:${flag} val="true"/>`, { val: "true" }],
      [`<c:${flag} val="false"/>`, { val: "false" }]
    ] as const) {
      const labels = inventory(
        `<c:plotArea><c:barChart><c:dLbls>${markup}</c:dLbls></c:barChart></c:plotArea>`
      ).plots[0]!.labels!;
      expect(labels.children[0]?.attributes ?? null).toEqual(attributes);
    }
  }
);

it.each([
  ["", null],
  ["<c:numFmt/>", {}],
  ['<c:numFmt sourceLinked="0"/>', { sourceLinked: "0" }],
  ['<c:numFmt sourceLinked="1"/>', { sourceLinked: "1" }],
  ['<c:numFmt formatCode="General"/>', { formatCode: "General" }],
  ['<c:numFmt formatCode="00.00"/>', { formatCode: "00.00" }]
])("retains label format attributes independently for %s", (markup, attributes) => {
  const labels = inventory(
    `<c:plotArea><c:barChart><c:dLbls>${markup}</c:dLbls></c:barChart></c:plotArea>`
  ).plots[0]!.labels!;
  expect(labels.children[0]?.attributes ?? null).toEqual(attributes);
});

it.each([
  ["", null],
  ["<c:legendPos/>", {}],
  ['<c:legendPos val="r"/>', { val: "r" }],
  ['<c:legendPos val="b"/>', { val: "b" }],
  ["<c:overlay/>", {}],
  ['<c:overlay val="0"/>', { val: "0" }],
  ['<c:overlay val="1"/>', { val: "1" }]
])("retains legend position and overlay source state %s", (markup, attributes) => {
  expect(
    inventory(`<c:legend>${markup}</c:legend>`).legend!.children[0]?.attributes ?? null
  ).toEqual(attributes);
});

it.each(["edge", "factor"])(
  "retains legend %s positioning and signed fractional offset",
  (mode) => {
    for (const value of ["0.42", "-0.42", "0"]) {
      const result = inventory(
        `<c:legend><c:layout><c:manualLayout><c:xMode val="${mode}"/><c:x val="${value}"/></c:manualLayout></c:layout></c:legend>`
      );
      expect(
        result.legend!.children[0]!.children[0]!.children.map((node) => node.attributes)
      ).toEqual([{ val: mode }, { val: value }]);
    }
  }
);

it.each([
  ["", null],
  ["<c:numRef/>", []],
  ["<c:numLit/>", []],
  ["<c:numRef><c:numCache/></c:numRef>", []],
  ['<c:numRef><c:numCache><c:ptCount val="0"/></c:numCache></c:numRef>', []],
  [
    '<c:numRef><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>1.1</c:v></c:pt></c:numCache></c:numRef>',
    [{ index: "0", value: "1.1" }]
  ],
  [
    '<c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>1.1</c:v></c:pt><c:pt idx="2"><c:v>3.3</c:v></c:pt></c:numCache></c:numRef>',
    [
      { index: "0", value: "1.1" },
      { index: "2", value: "3.3" }
    ]
  ],
  [
    '<c:numLit><c:ptCount val="3"/><c:pt idx="0"><c:v>1.1</c:v></c:pt><c:pt idx="2"><c:v>3.3</c:v></c:pt></c:numLit>',
    [
      { index: "0", value: "1.1" },
      { index: "2", value: "3.3" }
    ]
  ],
  [
    '<c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="2"><c:v>3.3</c:v></c:pt><c:pt idx="0"><c:v>1.1</c:v></c:pt></c:numCache></c:numRef>',
    [
      { index: "2", value: "3.3" },
      { index: "0", value: "1.1" }
    ]
  ]
])("preserves series cache state and explicit point order %s", (markup, points) => {
  const result = inventory(
    `<c:plotArea><c:barChart><c:ser>${markup ? `<c:val>${markup}</c:val>` : ""}</c:ser></c:barChart></c:plotArea>`
  );
  expect(result.plots[0]!.series[0]!.values?.points ?? null).toEqual(points);
});

it.each([
  ["", 0, null],
  ['<c:dLbl><c:idx val="42"/></c:dLbl>', 1, null],
  ['<c:dLbl><c:idx val="42"/><c:dLblPos val="b"/></c:dLbl>', 1, { val: "b" }]
])(
  "retains explicit point label position without creating point metadata %s",
  (markup, count, position) => {
    const result = inventory(
      `<c:plotArea><c:barChart><c:ser><c:dLbls>${markup}</c:dLbls></c:ser></c:barChart></c:plotArea>`
    );
    const nodes: readonly ChartXmlNode[] = result.plots[0]!.series[0]!.labels!.children;
    expect(nodes.length).toBe(count);
    if (count === 1) expect(nodes[0]!.children[0]!.attributes).toEqual({ val: "42" });
    expect(nodes[0]?.children[1]?.attributes ?? null).toEqual(position);
    expect(result.plots[0]!.series[0]!.points).toEqual([]);
  }
);
