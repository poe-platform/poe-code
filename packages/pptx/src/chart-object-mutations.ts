import { applyChartFontUpdate } from "./chart-font-operations.js";
import {
  BarPlot,
  BubblePlot,
  BarSeries,
  LineSeries,
  RadarSeries,
  XySeries
} from "./chart-model-series.js";
import { Chart } from "./chart-model.js";
import {
  XL_AXIS_CROSSES,
  XL_DATA_LABEL_POSITION,
  XL_LEGEND_POSITION,
  XL_MARKER_STYLE,
  XL_TICK_LABEL_POSITION,
  XL_TICK_MARK
} from "./chart-enums.js";
import { PropertyAccessError } from "./errors.js";
import { validateChartObjectUpdates, type ChartObjectUpdate } from "./chart-object-operations.js";
import type { XmlPart } from "./xml.js";

export function applyChartObjectUpdates(
  document: XmlPart,
  updates: readonly ChartObjectUpdate[]
): XmlPart {
  validateChartObjectUpdates(updates);
  const chart = new Chart(
    () => document,
    (next) => {
      document = next;
    }
  );
  for (const edit of updates) {
    switch (edit.target) {
      case "font": {
        const { target: ignoredTarget, ...font } = edit;
        applyChartFontUpdate(chart, font);
        break;
      }
      case "format": {
        const series = () => chart.series.at(edit.series!);
        const owner = (() => {
          switch (edit.owner) {
            case "title":
              return chart.chart_title;
            case "legend": {
              if (!chart.legend) throw new PropertyAccessError();
              return chart.legend;
            }
            case "categoryAxis":
              return chart.category_axis;
            case "valueAxis":
              return chart.value_axis;
            case "categoryAxisTitle":
              return chart.category_axis.axis_title;
            case "valueAxisTitle":
              return chart.value_axis.axis_title;
            case "categoryMajorGridlines":
              return chart.category_axis.major_gridlines;
            case "valueMajorGridlines":
              return chart.value_axis.major_gridlines;
            case "series":
              return series();
            case "point":
              return series().points.at(edit.point!);
            case "marker": {
              const selected = series();
              if (edit.point !== undefined) return selected.points.at(edit.point).marker;
              if (!(selected instanceof RadarSeries || selected instanceof XySeries))
                throw new PropertyAccessError();
              return selected.marker;
            }
          }
        })();
        owner.format.apply(edit.drawing);
        break;
      }
      case "chart":
        if (edit.hasTitle !== undefined) chart.has_title = edit.hasTitle as boolean;
        if (edit.hasLegend !== undefined) chart.has_legend = edit.hasLegend as boolean;
        if (edit.style !== undefined) chart.chart_style = edit.style as number | null;
        break;
      case "title": {
        const title = chart.chart_title;
        if (edit.hasTextFrame !== undefined) title.has_text_frame = edit.hasTextFrame as boolean;
        if (edit.text !== undefined) title.text_frame.text = edit.text as string;
        break;
      }
      case "legend": {
        const legend = chart.legend;
        if (!legend) throw new PropertyAccessError();
        if (edit.position !== undefined)
          legend.position = XL_LEGEND_POSITION[
            edit.position as keyof typeof XL_LEGEND_POSITION
          ] as XL_LEGEND_POSITION;
        if (edit.includeInLayout !== undefined)
          legend.include_in_layout = edit.includeInLayout as boolean;
        if (edit.horzOffset !== undefined) legend.horz_offset = edit.horzOffset as number;
        break;
      }
      case "categoryAxis":
      case "valueAxis": {
        const axis = edit.target === "categoryAxis" ? chart.category_axis : chart.value_axis;
        if (edit.hasTitle !== undefined) axis.has_title = edit.hasTitle as boolean;
        if (edit.hasMajorGridlines !== undefined)
          axis.has_major_gridlines = edit.hasMajorGridlines as boolean;
        if (edit.hasMinorGridlines !== undefined)
          axis.has_minor_gridlines = edit.hasMinorGridlines as boolean;
        if (edit.majorTickMark !== undefined)
          axis.major_tick_mark = XL_TICK_MARK[
            edit.majorTickMark as keyof typeof XL_TICK_MARK
          ] as XL_TICK_MARK;
        if (edit.minorTickMark !== undefined)
          axis.minor_tick_mark = XL_TICK_MARK[
            edit.minorTickMark as keyof typeof XL_TICK_MARK
          ] as XL_TICK_MARK;
        if (edit.maximumScale !== undefined)
          axis.maximum_scale = edit.maximumScale as number | null;
        if (edit.minimumScale !== undefined)
          axis.minimum_scale = edit.minimumScale as number | null;
        if (edit.reverseOrder !== undefined) axis.reverse_order = edit.reverseOrder as boolean;
        if (edit.tickLabelPosition !== undefined)
          axis.tick_label_position = XL_TICK_LABEL_POSITION[
            edit.tickLabelPosition as keyof typeof XL_TICK_LABEL_POSITION
          ] as XL_TICK_LABEL_POSITION;
        if (edit.visible !== undefined) axis.visible = edit.visible as boolean;
        if (edit.target === "valueAxis") {
          const value = chart.value_axis;
          if (edit.crosses !== undefined)
            value.crosses = XL_AXIS_CROSSES[
              edit.crosses as keyof typeof XL_AXIS_CROSSES
            ] as XL_AXIS_CROSSES;
          if (edit.crossesAt !== undefined) value.crosses_at = edit.crossesAt as number | null;
          if (edit.majorUnit !== undefined) value.major_unit = edit.majorUnit as number | null;
          if (edit.minorUnit !== undefined) value.minor_unit = edit.minorUnit as number | null;
        }
        break;
      }
      case "axisTitle": {
        const title = (edit.axis === "category" ? chart.category_axis : chart.value_axis)
          .axis_title;
        if (edit.hasTextFrame !== undefined) title.has_text_frame = edit.hasTextFrame as boolean;
        if (edit.text !== undefined) title.text_frame.text = edit.text as string;
        break;
      }
      case "tickLabels": {
        const labels = (edit.axis === "category" ? chart.category_axis : chart.value_axis)
          .tick_labels;
        if (edit.numberFormat !== undefined) labels.number_format = edit.numberFormat as string;
        if (edit.numberFormatIsLinked !== undefined)
          labels.number_format_is_linked = edit.numberFormatIsLinked as boolean;
        if (edit.offset !== undefined) labels.offset = edit.offset as number;
        break;
      }
      case "plot": {
        const plot = chart.plots.at(edit.plot as number);
        if (edit.hasDataLabels !== undefined) plot.has_data_labels = edit.hasDataLabels as boolean;
        if (edit.varyByCategories !== undefined)
          plot.vary_by_categories = edit.varyByCategories as boolean;
        if (edit.gapWidth !== undefined) {
          if (!(plot instanceof BarPlot)) throw new PropertyAccessError();
          plot.gap_width = edit.gapWidth;
        }
        if (edit.overlap !== undefined) {
          if (!(plot instanceof BarPlot)) throw new PropertyAccessError();
          plot.overlap = edit.overlap;
        }
        if (edit.bubbleScale !== undefined) {
          if (!(plot instanceof BubblePlot)) throw new PropertyAccessError();
          plot.bubble_scale = edit.bubbleScale;
        }
        break;
      }
      case "series": {
        const series = chart.series.at(edit.series as number);
        if (edit.invertIfNegative !== undefined) {
          if (!(series instanceof BarSeries)) throw new PropertyAccessError();
          series.invert_if_negative = edit.invertIfNegative;
        }
        if (edit.smooth !== undefined) {
          if (!(series instanceof LineSeries)) throw new PropertyAccessError();
          series.smooth = edit.smooth;
        }
        break;
      }
      case "marker": {
        const series = chart.series.at(edit.series as number);
        if (
          edit.point === undefined &&
          !(series instanceof RadarSeries || series instanceof XySeries)
        )
          throw new PropertyAccessError();
        const marker =
          edit.point === undefined
            ? (series as RadarSeries | XySeries).marker
            : series.points.at(edit.point).marker;
        if (edit.style !== undefined)
          marker.style =
            edit.style === null
              ? null
              : (XL_MARKER_STYLE[edit.style as keyof typeof XL_MARKER_STYLE] as XL_MARKER_STYLE);
        if (edit.size !== undefined) marker.size = edit.size as number | null;
        break;
      }
      case "dataLabels": {
        const labels = chart.plots.at(edit.plot as number).data_labels;
        if (edit.position !== undefined)
          labels.position =
            edit.position === null
              ? null
              : (XL_DATA_LABEL_POSITION[
                  edit.position as keyof typeof XL_DATA_LABEL_POSITION
                ] as XL_DATA_LABEL_POSITION);
        if (edit.numberFormat !== undefined) labels.number_format = edit.numberFormat as string;
        if (edit.numberFormatIsLinked !== undefined)
          labels.number_format_is_linked = edit.numberFormatIsLinked as boolean;
        if (edit.showCategoryName !== undefined)
          labels.show_category_name = edit.showCategoryName as boolean;
        if (edit.showLegendKey !== undefined)
          labels.show_legend_key = edit.showLegendKey as boolean;
        if (edit.showPercentage !== undefined)
          labels.show_percentage = edit.showPercentage as boolean;
        if (edit.showSeriesName !== undefined)
          labels.show_series_name = edit.showSeriesName as boolean;
        if (edit.showValue !== undefined) labels.show_value = edit.showValue as boolean;
        break;
      }
      case "dataLabel": {
        const label = chart.series
          .at(edit.series as number)
          .points.at(edit.point as number).data_label;
        if (edit.position !== undefined)
          label.position =
            edit.position === null
              ? null
              : (XL_DATA_LABEL_POSITION[
                  edit.position as keyof typeof XL_DATA_LABEL_POSITION
                ] as XL_DATA_LABEL_POSITION);
        if (edit.hasTextFrame !== undefined) label.has_text_frame = edit.hasTextFrame as boolean;
        if (edit.text !== undefined) label.text_frame.text = edit.text as string;
        break;
      }
    }
  }
  return document;
}
