import { expect, it } from "vitest";
import { Chart } from "./chart-model.js";
import {
  XL_AXIS_CROSSES,
  XL_DATA_LABEL_POSITION,
  XL_TICK_LABEL_POSITION,
  XL_LEGEND_POSITION,
  XL_MARKER_STYLE,
  XL_TICK_MARK
} from "./chart-enums.js";
import { BarPlot, BubblePlot, BarSeries, LineSeries, XySeries } from "./chart-model-series.js";
import { DateAxis } from "./chart-model-axes.js";
import { parseXmlPart } from "./xml.js";
function chart(
  plot = '<c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Revenue</c:v></c:tx><c:val><c:numLit><c:ptCount val="3"/><c:pt idx="0"><c:v>4</c:v></c:pt><c:pt idx="2"><c:v>8</c:v></c:pt></c:numLit></c:val></c:ser></c:barChart>',
  axisKind = "catAx"
) {
  let xml = parseXmlPart(
    new TextEncoder().encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea>${plot}<c:${axisKind}><c:axId val="1"/><c:scaling/><c:crossAx val="2"/></c:${axisKind}><c:valAx><c:axId val="2"/><c:scaling/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart><c:extLst/></c:chartSpace>`
    ),
    { maxBytes: 100000, maxNodes: 1000, maxDepth: 30 }
  );
  return {
    model: new Chart(
      () => xml,
      (next) => {
        xml = next;
      }
    ),
    xml: () => new TextDecoder().decode(xml.bytes())
  };
}
it("creates chart and axis rich titles through live shared text frames", () => {
  const { model, xml } = chart();
  expect(model.has_title).toBe(false);
  const title = model.chart_title;
  expect(model.has_title).toBe(true);
  expect(title.has_text_frame).toBe(false);
  title.text_frame.text = "Annual totals";
  expect(title.text_frame.text).toBe("Annual totals");
  title.text_frame.paragraphs[0]!.font.bold = true;
  expect(title.text_frame.paragraphs[0]!.font.bold).toBe(true);
  model.category_axis.axis_title.text_frame.text = "Quarter";
  expect(model.category_axis.has_title).toBe(true);
  model.has_title = false;
  expect(model.has_title).toBe(false);
  expect(() => title.text_frame).toThrow();
  expect(xml()).toContain("<c:extLst/>");
});
it("edits legend layout and shared font with defaults", () => {
  const { model } = chart();
  expect(model.legend).toBeNull();
  model.has_legend = true;
  const legend = model.legend!;
  expect(legend.position).toBe(XL_LEGEND_POSITION.RIGHT);
  expect(legend.horz_offset).toBe(0);
  legend.position = XL_LEGEND_POSITION.BOTTOM;
  legend.horz_offset = -0.15;
  legend.include_in_layout = false;
  legend.font.italic = true;
  expect(model.legend!.position).toBe(XL_LEGEND_POSITION.BOTTOM);
  expect(model.legend!.horz_offset).toBe(-0.15);
  expect(model.legend!.include_in_layout).toBe(false);
  expect(model.legend!.font.italic).toBe(true);
});
it("edits axis scale, crossed-axis choices, ticks and number formatting", () => {
  const { model, xml } = chart();
  const axis = model.value_axis;
  expect(axis.visible).toBe(true);
  expect(axis.minimum_scale).toBeNull();
  expect(axis.major_tick_mark).toBe(XL_TICK_MARK.NONE);
  axis.minimum_scale = -5;
  axis.maximum_scale = 12;
  axis.major_unit = 2;
  axis.minor_unit = 0.5;
  axis.reverse_order = true;
  axis.visible = false;
  axis.major_tick_mark = XL_TICK_MARK.OUTSIDE;
  axis.crosses_at = 3;
  expect(axis.crosses).toBe(XL_AXIS_CROSSES.CUSTOM);
  expect(axis.crosses_at).toBe(3);
  expect(xml()).toContain('val="3"></c:crossesAt>');
  axis.tick_labels.number_format = "0.00";
  expect(axis.tick_labels.number_format_is_linked).toBe(false);
  expect(axis.tick_labels.offset).toBe(100);
  axis.tick_labels.offset = 0;
  axis.has_major_gridlines = true;
  axis.major_gridlines.format.line.width = null;
  expect(axis.has_major_gridlines).toBe(true);
  const before = xml();
  expect(() => {
    axis.major_unit = 0;
  }).toThrow();
  expect(xml()).toBe(before);
});
it("exposes sparse series points, markers and data labels with checked collections", () => {
  const { model } = chart();
  const plot = model.plots.at(0);
  const series = plot.series.at(0);
  expect(plot.chart).toBe(model);
  expect(series.name).toBe("Revenue");
  expect(series.values).toEqual([4, null, 8]);
  expect(series.points.length).toBe(3);
  expect(() => series.points.at(-1)).toThrow();
  expect(series.points.at(0).marker.size).toBeNull();
  const marker = series.points.at(0).marker;
  marker.size = 12;
  marker.style = XL_MARKER_STYLE.STAR;
  expect(series.points.at(0).marker.size).toBe(12);
  expect(series.points.at(0).marker.style).toBe(XL_MARKER_STYLE.STAR);
  expect(() => {
    marker.size = 73;
  }).toThrow();
  const label = series.points.at(2).data_label;
  label.text_frame.text = "Peak";
  expect(label.text_frame.text).toBe("Peak");
  expect(plot.has_data_labels).toBe(false);
  plot.has_data_labels = true;
  plot.data_labels.show_value = true;
  plot.data_labels.show_category_name = false;
  expect(plot.data_labels.show_value).toBe(true);
  expect(plot.data_labels.show_category_name).toBe(false);
});
it("does not resurrect a removed title handle when another title is created", () => {
  const { model } = chart();
  const title = model.chart_title;
  title.text_frame.text = "Old";
  model.has_title = false;
  model.has_title = true;
  expect(() => title.text_frame).toThrow();
  expect(model.chart_title.has_text_frame).toBe(false);
});
it("retains stable series identity when unrelated chart properties change", () => {
  const { model } = chart();
  const series = model.series.at(0);
  model.chart_style = 4;
  model.has_title = true;
  expect(series.values).toEqual([4, null, 8]);
  expect(model.series.includes(series)).toBe(true);
});

it("keeps point and label inspection noncreating", () => {
  const { model, xml } = chart();
  const before = xml();
  const point = model.series.at(0).points.at(0);
  expect(point.marker.size).toBeNull();
  expect(point.data_label.has_text_frame).toBe(false);
  expect(point.data_label.position).toBeNull();
  expect(model.value_axis.major_gridlines).toBeDefined();
  expect(xml()).toBe(before);
});

it.each(["catAx", "dateAx", "valAx"])(
  "covers every base axis scalar and nullable scale on %s",
  (kind) => {
    const { model } = chart(undefined, kind === "dateAx" ? "dateAx" : "catAx");
    const axis = kind === "valAx" ? model.value_axis : model.category_axis;
    if (kind === "dateAx") expect(axis).toBeInstanceOf(DateAxis);
    for (const value of [false, true]) {
      axis.has_title = value;
      expect(axis.has_title).toBe(value);
      axis.has_major_gridlines = value;
      expect(axis.has_major_gridlines).toBe(value);
      axis.has_minor_gridlines = value;
      expect(axis.has_minor_gridlines).toBe(value);
      axis.visible = value;
      expect(axis.visible).toBe(value);
      axis.reverse_order = value;
      expect(axis.reverse_order).toBe(value);
    }
    for (const value of [null, -12.5, 0, 72.25]) {
      axis.minimum_scale = value;
      axis.maximum_scale = value;
      expect(axis.minimum_scale).toBe(value);
      expect(axis.maximum_scale).toBe(value);
    }
    for (const value of Object.values(XL_TICK_LABEL_POSITION)) {
      if (typeof value !== "number") continue;
      axis.tick_label_position = value;
      expect(axis.tick_label_position).toBe(value);
    }
    for (const value of [
      XL_TICK_MARK.NONE,
      XL_TICK_MARK.INSIDE,
      XL_TICK_MARK.OUTSIDE,
      XL_TICK_MARK.CROSS
    ]) {
      axis.major_tick_mark = value;
      axis.minor_tick_mark = value;
      expect(axis.major_tick_mark).toBe(value);
      expect(axis.minor_tick_mark).toBe(value);
    }
    axis.tick_labels.font.bold = true;
    expect(axis.tick_labels.font.bold).toBe(true);
    axis.tick_labels.number_format = "0%";
    expect(axis.tick_labels.number_format).toBe("0%");
    for (const linked of [false, true]) {
      axis.tick_labels.number_format_is_linked = linked;
      expect(axis.tick_labels.number_format_is_linked).toBe(linked);
    }
    for (const offset of [0, 500, 1000]) {
      axis.tick_labels.offset = offset;
      expect(axis.tick_labels.offset).toBe(offset);
    }
  }
);
it.each([
  "areaChart",
  "area3DChart",
  "barChart",
  "bar3DChart",
  "bubbleChart",
  "doughnutChart",
  "lineChart",
  "line3DChart",
  "ofPieChart",
  "pieChart",
  "pie3DChart",
  "radarChart",
  "scatterChart",
  "stockChart",
  "surfaceChart",
  "surface3DChart"
])("edits common plot/series/point/labels without reconstructing %s", (kind) => {
  const { model, xml } = chart(
    `<c:${kind}><c:ser><c:idx val="4"/><c:order val="0"/><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>5</c:v></c:pt></c:numLit></c:val><c:extLst/></c:ser><c:extLst/></c:${kind}>`
  );
  const plot = model.plots.at(0),
    series = plot.series.at(0);
  expect(plot.vary_by_categories).toBe(true);
  expect(plot.has_data_labels).toBe(false);
  expect(() => plot.data_labels).toThrow();
  for (const value of [false, true]) {
    plot.vary_by_categories = value;
    expect(plot.vary_by_categories).toBe(value);
  }
  plot.has_data_labels = true;
  const labels = plot.data_labels;
  expect(labels.number_format).toBe("General");
  expect(labels.number_format_is_linked).toBe(true);
  expect(labels.position).toBeNull();
  for (const value of [false, true]) {
    labels.show_value = value;
    labels.show_category_name = value;
    labels.show_legend_key = value;
    labels.show_percentage = value;
    labels.show_series_name = value;
    expect([
      labels.show_value,
      labels.show_category_name,
      labels.show_legend_key,
      labels.show_percentage,
      labels.show_series_name
    ]).toEqual(Array(5).fill(value));
  }
  labels.number_format = "0.0";
  expect(labels.number_format_is_linked).toBe(false);
  labels.font.italic = true;
  expect(labels.font.italic).toBe(true);
  expect(series.index).toBe(4);
  expect(series.name).toBe("");
  expect(series.values).toEqual([5]);
  expect(series.points[0]!.equals(series.points.at(0))).toBe(true);
  series.points.at(0).format.fill.solid();
  series.points.at(0).format.fill.background();
  expect(series.points.at(0).format.fill.type).toBe(5);
  expect(xml()).toContain("<c:extLst/>");
  plot.has_data_labels = false;
  expect(() => labels.show_value).toThrow();
});
it("covers all writable marker enums and data label positions", () => {
  const { model } = chart();
  const point = model.series.at(0).points.at(0),
    marker = point.marker,
    label = point.data_label;
  for (const value of Object.values(XL_MARKER_STYLE)) {
    if (typeof value !== "number") continue;
    marker.style = value;
    expect(marker.style).toBe(value);
  }
  for (const value of Object.values(XL_DATA_LABEL_POSITION)) {
    if (typeof value !== "number" || value === XL_DATA_LABEL_POSITION.MIXED) continue;
    label.position = value;
    expect(label.position).toBe(value);
  }
  label.position = null;
  expect(label.position).toBeNull();
  marker.style = null;
  marker.size = null;
  expect(marker.style).toBeNull();
  expect(marker.size).toBeNull();
  label.has_text_frame = true;
  label.font.bold = true;
  expect(label.font.bold).toBe(true);
  label.text_frame.text = "Custom";
  label.has_text_frame = false;
  expect(label.has_text_frame).toBe(false);
});
it("shares gradients, patterns, theme brightness, line and shadow behavior on chart objects", () => {
  const { model } = chart();
  const format = model.series.at(0).format;
  format.fill.gradient();
  format.fill.gradient_angle = 37;
  expect(format.fill.gradient_angle).toBe(37);
  format.fill.gradient_stops.at(1).position = 0.7;
  expect(format.fill.gradient_stops.at(1).position).toBe(0.7);
  format.line.width = null;
  expect(format.line.width.emu).toBe(0);
  format.shadow.inherit = false;
  expect(format.shadow.inherit).toBe(false);
  format.shadow.inherit = true;
  expect(format.shadow.inherit).toBe(true);
});
it("retains subtype defaults, boundary scalars, and series-specific marker behavior", () => {
  const { model } = chart();
  const plot = model.plots.at(0) as BarPlot,
    series = model.series.at(0) as BarSeries;
  expect(plot.gap_width).toBe(150);
  expect(plot.overlap).toBe(0);
  expect(series.invert_if_negative).toBe(true);
  for (const gap of [0, 500]) {
    plot.gap_width = gap;
    expect(plot.gap_width).toBe(gap);
  }
  for (const overlap of [-100, 0, 100]) {
    plot.overlap = overlap;
    expect(plot.overlap).toBe(overlap);
  }
  series.invert_if_negative = false;
  expect(series.invert_if_negative).toBe(false);
  const bubble = chart("<c:bubbleChart><c:ser/></c:bubbleChart>").model.plots.at(0) as BubblePlot;
  expect(bubble.bubble_scale).toBe(100);
  for (const scale of [0, 300]) {
    bubble.bubble_scale = scale;
    expect(bubble.bubble_scale).toBe(scale);
  }
  const line = chart("<c:lineChart><c:ser/></c:lineChart>").model.series.at(0) as LineSeries;
  expect(line.smooth).toBe(false);
  line.smooth = true;
  expect(line.smooth).toBe(true);
  line.marker.size = 2;
  expect(line.marker.size).toBe(2);
  const xy = chart(
    '<c:scatterChart><c:ser><c:yVal><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>7</c:v></c:pt></c:numLit></c:yVal></c:ser></c:scatterChart>'
  ).model.series.at(0) as XySeries;
  expect([...xy.iter_values()]).toEqual([7]);
});
it("covers legend position enums, axis crossing alternatives and checked collection bounds", () => {
  const { model } = chart();
  model.has_legend = true;
  const legend = model.legend!,
    axis = model.value_axis;
  expect(legend.include_in_layout).toBe(false);
  for (const position of Object.values(XL_LEGEND_POSITION)) {
    if (typeof position !== "number" || position === XL_LEGEND_POSITION.CUSTOM) continue;
    legend.position = position;
    expect(legend.position).toBe(position);
  }
  for (const crosses of [
    XL_AXIS_CROSSES.AUTOMATIC,
    XL_AXIS_CROSSES.MINIMUM,
    XL_AXIS_CROSSES.MAXIMUM
  ]) {
    axis.crosses_at = 6;
    axis.crosses = crosses;
    expect(axis.crosses).toBe(crosses);
    expect(axis.crosses_at).toBeNull();
  }
  axis.crosses_at = null;
  expect(axis.crosses).toBe(XL_AXIS_CROSSES.CUSTOM);
  for (const unit of [null, 0.25, 17]) {
    axis.major_unit = unit;
    axis.minor_unit = unit;
    expect(axis.major_unit).toBe(unit);
    expect(axis.minor_unit).toBe(unit);
  }
  expect(model.plots.at(-1).equals(model.plots[0])).toBe(true);
  expect(model.plots.slice(undefined, undefined, -1)).toHaveLength(1);
  expect(() => model.plots.at(1)).toThrow();
  expect(() => model.series.at(0).points.at(-1)).toThrow();
  expect([...model.series.reversed()][0]!.equals(model.series.at(0))).toBe(true);
  expect(() => Reflect.set(model.series, "0", model.series.at(0))).toThrow();
});
it("keeps chart owner callback capabilities off returned graph instances", () => {
  const { model } = chart();
  const objects = [
    model.chart_title,
    model.value_axis,
    model.series.at(0),
    model.series.at(0).format
  ];
  for (const object of objects) {
    expect(Reflect.get(object, "binding")).toBeUndefined();
    expect(Reflect.get(object, "descendant")).toBeUndefined();
    expect(Reflect.get(object, "optionalDescendant")).toBeUndefined();
  }
});
it("clears nullable layout and bubble overrides and bounds inherited collection searches", () => {
  const { model } = chart();
  model.has_legend = true;
  const legend = model.legend!;
  legend.horz_offset = 0.3;
  legend.horz_offset = null;
  expect(legend.horz_offset).toBe(0);
  legend.include_in_layout = false;
  legend.include_in_layout = null;
  expect(legend.include_in_layout).toBe(true);
  const bubble = chart("<c:bubbleChart/>").model.plots.at(0) as BubblePlot;
  bubble.bubble_scale = 120;
  bubble.bubble_scale = null;
  expect(bubble.bubble_scale).toBe(100);
  const series = model.series.at(0);
  expect(model.series.index(series, 0, 1)).toBe(0);
  expect(() => model.series.index(series, 1)).toThrow();
});
