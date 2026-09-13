import { expect, it } from "vitest";
import { createChartXml, validateChartData, type CreatableChartType } from "./chart-editing.js";

const variants: readonly [CreatableChartType, readonly string[]][] = [
  ["BAR_CLUSTERED", ['<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/>']],
  [
    "BAR_STACKED",
    ['<c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/>', '<c:overlap val="100"/>']
  ],
  [
    "BAR_STACKED_100",
    [
      '<c:barChart><c:barDir val="bar"/><c:grouping val="percentStacked"/>',
      '<c:overlap val="100"/>'
    ]
  ],
  ["COLUMN_CLUSTERED", ['<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>']],
  [
    "COLUMN_STACKED",
    ['<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>', '<c:overlap val="100"/>']
  ],
  [
    "COLUMN_STACKED_100",
    [
      '<c:barChart><c:barDir val="col"/><c:grouping val="percentStacked"/>',
      '<c:overlap val="100"/>'
    ]
  ],
  [
    "LINE",
    ['<c:lineChart><c:grouping val="standard"/>', '<c:marker><c:symbol val="none"/></c:marker>']
  ],
  [
    "LINE_MARKERS",
    ['<c:lineChart><c:grouping val="standard"/>', '<c:marker><c:symbol val="circle"/></c:marker>']
  ],
  [
    "LINE_MARKERS_STACKED",
    ['<c:lineChart><c:grouping val="stacked"/>', '<c:marker><c:symbol val="circle"/></c:marker>']
  ],
  [
    "LINE_MARKERS_STACKED_100",
    [
      '<c:lineChart><c:grouping val="percentStacked"/>',
      '<c:marker><c:symbol val="circle"/></c:marker>'
    ]
  ],
  [
    "LINE_STACKED",
    ['<c:lineChart><c:grouping val="stacked"/>', '<c:marker><c:symbol val="none"/></c:marker>']
  ],
  [
    "LINE_STACKED_100",
    [
      '<c:lineChart><c:grouping val="percentStacked"/>',
      '<c:marker><c:symbol val="none"/></c:marker>'
    ]
  ],
  ["PIE", ['<c:pieChart><c:varyColors val="1"/>', '<c:firstSliceAng val="0"/>']],
  ["PIE_EXPLODED", ['<c:pieChart><c:varyColors val="1"/>', '<c:explosion val="25"/>']],
  [
    "XY_SCATTER",
    [
      '<c:scatterChart><c:scatterStyle val="marker"/>',
      '<c:marker><c:symbol val="circle"/></c:marker>',
      '<c:smooth val="0"/>'
    ]
  ],
  [
    "XY_SCATTER_LINES",
    [
      '<c:scatterChart><c:scatterStyle val="lineMarker"/>',
      '<c:marker><c:symbol val="circle"/></c:marker>',
      '<c:smooth val="0"/>'
    ]
  ],
  [
    "XY_SCATTER_LINES_NO_MARKERS",
    [
      '<c:scatterChart><c:scatterStyle val="line"/>',
      '<c:marker><c:symbol val="none"/></c:marker>',
      '<c:smooth val="0"/>'
    ]
  ],
  [
    "XY_SCATTER_SMOOTH",
    [
      '<c:scatterChart><c:scatterStyle val="smoothMarker"/>',
      '<c:marker><c:symbol val="circle"/></c:marker>',
      '<c:smooth val="1"/>'
    ]
  ],
  [
    "XY_SCATTER_SMOOTH_NO_MARKERS",
    [
      '<c:scatterChart><c:scatterStyle val="smooth"/>',
      '<c:marker><c:symbol val="none"/></c:marker>',
      '<c:smooth val="1"/>'
    ]
  ]
];

it.each(variants)(
  "encodes independently specified direction grouping and marker semantics for %s",
  (type, fragments) => {
    const data = type.startsWith("XY_")
      ? { series: [{ name: "Soundings", xValues: [9, 2, 9], values: [0, null, -4] }] }
      : {
          categories: ["Harbor", null, "Harbor"],
          series: [{ name: "Soundings", values: [0, null, -4] }]
        };
    const xml = createChartXml(type, data);
    for (const fragment of fragments) expect(xml).toContain(fragment);
    expect(xml).toContain('<c:idx val="0"/><c:order val="0"/>');
    expect(xml).toContain('<c:dispBlanksAs val="gap"/>');
  }
);

it("keeps numeric category order and series values in separate independently specified caches", () => {
  const xml = createChartXml("BAR_CLUSTERED", {
    categories: [8, null, -3],
    series: [{ name: "Depth", values: [2, 0, null] }]
  });
  expect(xml).toContain(
    '<c:cat><c:numRef><c:f>Sheet1!$A$2:$A$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>8</c:v></c:pt><c:pt idx="2"><c:v>-3</c:v></c:pt></c:numCache></c:numRef></c:cat>'
  );
  expect(xml).toContain(
    '<c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>2</c:v></c:pt><c:pt idx="1"><c:v>0</c:v></c:pt></c:numCache></c:numRef></c:val>'
  );
});

it("retains explicit empty labels while keeping absent category points sparse", () => {
  const xml = createChartXml("LINE", {
    categories: ["", null, ""],
    series: [{ name: "", values: [null, null, null] }]
  });
  expect(xml).toContain(
    '<c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v></c:v></c:pt><c:pt idx="2"><c:v></c:v></c:pt></c:strCache>'
  );
  expect(xml).toContain(
    '<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/></c:numCache>'
  );
});

it("rejects absent and sparse arrays instead of silently filling chart points", () => {
  const sparse = new Array<number>(2);
  sparse[1] = 8;
  const cases: unknown[] = [
    { categories: ["A"], series: [{ name: "A" }] },
    { categories: ["A"], series: [{ name: "A", values: [undefined] }] },
    { categories: ["A", "B"], series: [{ name: "A", values: sparse }] },
    { categories: ["A"], series: [{ name: "A", values: [NaN] }] }
  ];
  for (const data of cases) expect(() => validateChartData(data as never, "LINE")).toThrow();
});

it.each(["BAR_CLUSTERED", "LINE"] as const)(
  "uses independently specified UTC serial caches and date axes for %s",
  (type) => {
    const xml = createChartXml(type, {
      categories: ["1900-01-01T18:30:00Z", "1900-02-28T00:00:00Z", "1900-03-01T00:00:00Z"],
      series: [{ name: "Days", values: [1, 2, 3] }]
    });
    expect(xml).toContain(
      '<c:cat><c:numRef><c:f>Sheet1!$A$2:$A$4</c:f><c:numCache><c:formatCode>yyyy-mm-dd</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>59</c:v></c:pt><c:pt idx="2"><c:v>61</c:v></c:pt></c:numCache></c:numRef></c:cat>'
    );
    expect(xml).toContain('<c:dateAx><c:axId val="1"/>');
    expect(xml).toContain('<c:baseTimeUnit val="days"/>');
    expect(xml).toContain('<c:numFmt formatCode="yyyy-mm-dd" sourceLinked="1"/>');
  }
);

it("uses the supplied alternate date epoch without a host timezone", () => {
  const xml = createChartXml(
    "LINE",
    {
      categories: ["1904-01-01T00:00:00Z", null, "1904-01-03T23:59:59Z"],
      series: [{ name: "Days", values: [0, null, 2] }]
    },
    {},
    false,
    "Sheet1",
    true
  );
  expect(xml).toContain(
    '<c:numCache><c:formatCode>yyyy-mm-dd</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>0</c:v></c:pt><c:pt idx="2"><c:v>2</c:v></c:pt></c:numCache>'
  );
  expect(xml).toContain('<c:date1904 val="1"/>');
});
