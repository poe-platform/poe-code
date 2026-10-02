import { defineEnum, defineXmlEnum } from "./enum-definition.js";

enum XL_AXIS_CROSSESValues {
  AUTOMATIC = -4105,
  CUSTOM = -4114,
  MAXIMUM = 2,
  MINIMUM = 4
}
export type XL_AXIS_CROSSES = (typeof XL_AXIS_CROSSESValues)[keyof typeof XL_AXIS_CROSSESValues];
export const XL_AXIS_CROSSES = defineXmlEnum(XL_AXIS_CROSSESValues, {
  "2": "max",
  "4": "min",
  "-4105": "autoZero",
  "-4114": null
});

const XL_CATEGORY_TYPEValues = {
  AUTOMATIC_SCALE: -4105,
  CATEGORY_SCALE: 2,
  TIME_SCALE: 3
} as const;
export type XL_CATEGORY_TYPE = (typeof XL_CATEGORY_TYPEValues)[keyof typeof XL_CATEGORY_TYPEValues];
export const XL_CATEGORY_TYPE = defineEnum(XL_CATEGORY_TYPEValues);

const XL_CHART_TYPEValues = {
  THREE_D_AREA: -4098,
  THREE_D_AREA_STACKED: 78,
  THREE_D_AREA_STACKED_100: 79,
  THREE_D_BAR_CLUSTERED: 60,
  THREE_D_BAR_STACKED: 61,
  THREE_D_BAR_STACKED_100: 62,
  THREE_D_COLUMN: -4100,
  THREE_D_COLUMN_CLUSTERED: 54,
  THREE_D_COLUMN_STACKED: 55,
  THREE_D_COLUMN_STACKED_100: 56,
  THREE_D_LINE: -4101,
  THREE_D_PIE: -4102,
  THREE_D_PIE_EXPLODED: 70,
  AREA: 1,
  AREA_STACKED: 76,
  AREA_STACKED_100: 77,
  BAR_CLUSTERED: 57,
  BAR_OF_PIE: 71,
  BAR_STACKED: 58,
  BAR_STACKED_100: 59,
  BUBBLE: 15,
  BUBBLE_THREE_D_EFFECT: 87,
  COLUMN_CLUSTERED: 51,
  COLUMN_STACKED: 52,
  COLUMN_STACKED_100: 53,
  CONE_BAR_CLUSTERED: 102,
  CONE_BAR_STACKED: 103,
  CONE_BAR_STACKED_100: 104,
  CONE_COL: 105,
  CONE_COL_CLUSTERED: 99,
  CONE_COL_STACKED: 100,
  CONE_COL_STACKED_100: 101,
  CYLINDER_BAR_CLUSTERED: 95,
  CYLINDER_BAR_STACKED: 96,
  CYLINDER_BAR_STACKED_100: 97,
  CYLINDER_COL: 98,
  CYLINDER_COL_CLUSTERED: 92,
  CYLINDER_COL_STACKED: 93,
  CYLINDER_COL_STACKED_100: 94,
  DOUGHNUT: -4120,
  DOUGHNUT_EXPLODED: 80,
  LINE: 4,
  LINE_MARKERS: 65,
  LINE_MARKERS_STACKED: 66,
  LINE_MARKERS_STACKED_100: 67,
  LINE_STACKED: 63,
  LINE_STACKED_100: 64,
  PIE: 5,
  PIE_EXPLODED: 69,
  PIE_OF_PIE: 68,
  PYRAMID_BAR_CLUSTERED: 109,
  PYRAMID_BAR_STACKED: 110,
  PYRAMID_BAR_STACKED_100: 111,
  PYRAMID_COL: 112,
  PYRAMID_COL_CLUSTERED: 106,
  PYRAMID_COL_STACKED: 107,
  PYRAMID_COL_STACKED_100: 108,
  RADAR: -4151,
  RADAR_FILLED: 82,
  RADAR_MARKERS: 81,
  STOCK_HLC: 88,
  STOCK_OHLC: 89,
  STOCK_VHLC: 90,
  STOCK_VOHLC: 91,
  SURFACE: 83,
  SURFACE_TOP_VIEW: 85,
  SURFACE_TOP_VIEW_WIREFRAME: 86,
  SURFACE_WIREFRAME: 84,
  XY_SCATTER: -4169,
  XY_SCATTER_LINES: 74,
  XY_SCATTER_LINES_NO_MARKERS: 75,
  XY_SCATTER_SMOOTH: 72,
  XY_SCATTER_SMOOTH_NO_MARKERS: 73
} as const;
export type XL_CHART_TYPE = (typeof XL_CHART_TYPEValues)[keyof typeof XL_CHART_TYPEValues];
export const XL_CHART_TYPE = defineEnum(XL_CHART_TYPEValues);

const XL_DATA_LABEL_POSITIONValues = {
  ABOVE: 0,
  BELOW: 1,
  BEST_FIT: 5,
  CENTER: -4108,
  INSIDE_BASE: 4,
  INSIDE_END: 3,
  LEFT: -4131,
  MIXED: 6,
  OUTSIDE_END: 2,
  RIGHT: -4152
} as const;
export type XL_DATA_LABEL_POSITION =
  (typeof XL_DATA_LABEL_POSITIONValues)[keyof typeof XL_DATA_LABEL_POSITIONValues];
export const XL_DATA_LABEL_POSITION = defineXmlEnum(XL_DATA_LABEL_POSITIONValues, {
  "0": "t",
  "1": "b",
  "2": "outEnd",
  "3": "inEnd",
  "4": "inBase",
  "5": "bestFit",
  "6": null,
  "-4108": "ctr",
  "-4131": "l",
  "-4152": "r"
});
export { XL_DATA_LABEL_POSITION as XL_LABEL_POSITION };

const XL_LEGEND_POSITIONValues = {
  BOTTOM: -4107,
  CORNER: 2,
  CUSTOM: -4161,
  LEFT: -4131,
  RIGHT: -4152,
  TOP: -4160
} as const;
export type XL_LEGEND_POSITION =
  (typeof XL_LEGEND_POSITIONValues)[keyof typeof XL_LEGEND_POSITIONValues];
export const XL_LEGEND_POSITION = defineXmlEnum(XL_LEGEND_POSITIONValues, {
  "2": "tr",
  "-4107": "b",
  "-4161": null,
  "-4131": "l",
  "-4152": "r",
  "-4160": "t"
});

const XL_MARKER_STYLEValues = {
  AUTOMATIC: -4105,
  CIRCLE: 8,
  DASH: -4115,
  DIAMOND: 2,
  DOT: -4118,
  NONE: -4142,
  PICTURE: -4147,
  PLUS: 9,
  SQUARE: 1,
  STAR: 5,
  TRIANGLE: 3,
  X: -4168
} as const;
export type XL_MARKER_STYLE = (typeof XL_MARKER_STYLEValues)[keyof typeof XL_MARKER_STYLEValues];
export const XL_MARKER_STYLE = defineXmlEnum(XL_MARKER_STYLEValues, {
  "1": "square",
  "2": "diamond",
  "3": "triangle",
  "5": "star",
  "8": "circle",
  "9": "plus",
  "-4105": "auto",
  "-4115": "dash",
  "-4118": "dot",
  "-4142": "none",
  "-4147": "picture",
  "-4168": "x"
});

const XL_TICK_LABEL_POSITIONValues = {
  HIGH: -4127,
  LOW: -4134,
  NEXT_TO_AXIS: 4,
  NONE: -4142
} as const;
export type XL_TICK_LABEL_POSITION =
  (typeof XL_TICK_LABEL_POSITIONValues)[keyof typeof XL_TICK_LABEL_POSITIONValues];
export const XL_TICK_LABEL_POSITION = defineXmlEnum(XL_TICK_LABEL_POSITIONValues, {
  "4": "nextTo",
  "-4127": "high",
  "-4134": "low",
  "-4142": "none"
});

const XL_TICK_MARKValues = {
  CROSS: 4,
  INSIDE: 2,
  NONE: -4142,
  OUTSIDE: 3
} as const;
export type XL_TICK_MARK = (typeof XL_TICK_MARKValues)[keyof typeof XL_TICK_MARKValues];
export const XL_TICK_MARK = defineXmlEnum(XL_TICK_MARKValues, {
  "2": "in",
  "3": "out",
  "4": "cross",
  "-4142": "none"
});
