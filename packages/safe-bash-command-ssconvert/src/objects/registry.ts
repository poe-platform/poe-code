export type ObjectKind = "graph" | "image" | "shape" | "comment" | "control" | "component";
export interface ObjectType {
  readonly kind: ObjectKind;
  readonly aliases: readonly string[];
  readonly xmlExportName?: string;
}
/** Stable GTypes and historical XML spellings from released xml-sax-read.c. */
export const sheetObjectTypes: Readonly<Record<string, ObjectType>> = Object.freeze(Object.fromEntries(Object.entries({
  SheetObjectGraph: { kind: "graph", aliases: ["GnmGraph"] },
  SheetObjectImage: { kind: "image", aliases: [] },
  SheetObjectComponent: { kind: "component", aliases: [] },
  GnmCellComment: { kind: "comment", aliases: ["CellComment"], xmlExportName: "CellComment" },
  GnmSOFilled: { kind: "shape", aliases: ["SheetObjectFilled", "SheetObjectText", "Rectangle", "Ellipse"], xmlExportName: "SheetObjectFilled" },
  GnmSOLine: { kind: "shape", aliases: ["SheetObjectGraphic", "Line", "Arrow"], xmlExportName: "SheetObjectGraphic" },
  GnmSOPath: { kind: "shape", aliases: ["SheetObjectPath"], xmlExportName: "SheetObjectPath" },
  // The writer emits SheetObjectPolygon, but the released reader has no alias
  // or polygon SAX parser. Do not invent an import alias or child preservation.
  GnmSOPolygon: { kind: "shape", aliases: [], xmlExportName: "SheetObjectPolygon" },
  SheetWidgetFrame: { kind: "control", aliases: [] },
  SheetWidgetButton: { kind: "control", aliases: [] },
  SheetWidgetCheckbox: { kind: "control", aliases: [] },
  SheetWidgetRadioButton: { kind: "control", aliases: [] },
  SheetWidgetToggleButton: { kind: "control", aliases: [] },
  SheetWidgetList: { kind: "control", aliases: [] },
  SheetWidgetCombo: { kind: "control", aliases: [] },
  SheetWidgetSlider: { kind: "control", aliases: [] },
  SheetWidgetSpinbutton: { kind: "control", aliases: [] },
  SheetWidgetScrollbar: { kind: "control", aliases: [] }
} satisfies Record<string, ObjectType>).map(([name, type]) => [name, Object.freeze({ ...type, aliases: Object.freeze(type.aliases) })])));

export const objectKinds: Readonly<Record<string, ObjectKind>> = Object.freeze(Object.fromEntries(
  Object.entries(sheetObjectTypes).flatMap(([name, type]) => [name, ...type.aliases].map(spelling => [spelling, type.kind]))
));

/** Source census, not a claim that a plugin is activated or rendered. */
export const chartPlugins = Object.freeze(Object.fromEntries(Object.entries({
  GOffice_plot_barcol: ["GogLinePlot", "GogAreaPlot", "GogBarColPlot", "GogDropBarPlot", "GogMinMaxPlot"],
  GOffice_plot_distrib: ["GogBoxPlot", "GogHistogramPlot", "GogProbabilityPlot"],
  GOffice_plot_pie: ["GogRingPlot", "GogPiePlot"],
  GOffice_plot_radar: ["GogRadarPlot", "GogRadarAreaPlot", "GogPolarPlot", "GogColorPolarPlot"],
  GOffice_plot_surface: ["GogContourPlot", "XLContourPlot", "GogXYZContourPlot", "GogXYContourPlot", "GogSurfacePlot", "XLSurfacePlot", "GogXYZSurfacePlot", "GogXYSurfacePlot", "GogMatrixPlot", "GogXYMatrixPlot", "GogXYZMatrixPlot"],
  GOffice_plot_xy: ["GogXYPlot", "GogBubblePlot", "GogXYColorPlot", "GogXYDropBarPlot", "GogXYMinMaxPlot"],
  GOffice_reg_linear: ["GogLinRegCurve", "GogExpRegCurve", "GogPowerRegCurve", "GogLogRegCurve", "GogPolynomRegCurve"],
  GOffice_reg_logfit: ["GogLogFitCurve"],
  GOffice_smoothing: ["GogMovingAvg", "GogExpSmooth"],
  GOffice_lasem: ["GoLasemComponent"]
}).map(([plugin, types]) => [plugin, Object.freeze(types)]))) as Readonly<Record<string, readonly string[]>>;
