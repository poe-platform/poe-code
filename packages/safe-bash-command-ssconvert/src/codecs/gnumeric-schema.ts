// Parent/child edges transcribed from released xml-sax-read.c gnumeric_1_0_dtd.
export const gnumericChildren: Readonly<Record<string, readonly string[]>> = {
  "": [
    "Workbook"
  ],
  "Workbook": [
    "Attributes",
    "Calculation",
    "DateConvention",
    "Geometry",
    "Names",
    "SheetNameIndex",
    "Sheets",
    "Summary",
    "UIData",
    "Version"
  ],
  "Attributes": [
    "Attribute"
  ],
  "Attribute": [
    "name",
    "type",
    "value"
  ],
  "Summary": [
    "Item"
  ],
  "Item": [
    "name",
    "val-int",
    "val-string"
  ],
  "SheetNameIndex": [
    "SheetName"
  ],
  "Names": [
    "Name"
  ],
  "Name": [
    "name",
    "position",
    "value"
  ],
  "Sheets": [
    "Sheet"
  ],
  "Sheet": [
    "Cells",
    "Cols",
    "Filters",
    "MaxCol",
    "MaxRow",
    "MergedRegions",
    "Name",
    "Names",
    "Objects",
    "PrintInformation",
    "Rows",
    "Scenarios",
    "Selections",
    "SheetLayout",
    "Solver",
    "Styles",
    "Zoom"
  ],
  "PrintInformation": [
    "Footer",
    "Header",
    "Margins",
    "PrintUnit",
    "Scale",
    "comments",
    "do_not_print",
    "draft",
    "errors",
    "even_if_only_styles",
    "grid",
    "hPageBreaks",
    "hcenter",
    "monochrome",
    "order",
    "orientation",
    "paper",
    "print-to-uri",
    "print_range",
    "repeat_left",
    "repeat_top",
    "titles",
    "vPageBreaks",
    "vcenter"
  ],
  "Margins": [
    "bottom",
    "footer",
    "header",
    "left",
    "right",
    "top"
  ],
  "vPageBreaks": [
    "break"
  ],
  "hPageBreaks": [
    "break"
  ],
  "Styles": [
    "StyleRegion"
  ],
  "StyleRegion": [
    "Style"
  ],
  "Style": [
    "Condition",
    "Font",
    "HyperLink",
    "InputMessage",
    "StyleBorder",
    "Validation"
  ],
  "StyleBorder": [
    "Bottom",
    "Diagonal",
    "Left",
    "Rev-Diagonal",
    "Right",
    "Top"
  ],
  "Validation": [
    "Expression0",
    "Expression1"
  ],
  "Condition": [
    "Expression0",
    "Expression1",
    "Style"
  ],
  "Cols": [
    "ColInfo"
  ],
  "Rows": [
    "RowInfo"
  ],
  "Selections": [
    "Selection"
  ],
  "Cells": [
    "Cell"
  ],
  "Cell": [
    "Content"
  ],
  "MergedRegions": [
    "Merge"
  ],
  "Filters": [
    "Filter"
  ],
  "Filter": [
    "Field"
  ],
  "SheetLayout": [
    "FreezePanes"
  ],
  "Solver": [
    "Constr"
  ],
  "Scenarios": [
    "Scenario"
  ],
  "Scenario": [
    "Item"
  ],
  "Objects": [
    "Arrow",
    "CellComment",
    "Ellipse",
    "GnmGraph",
    "Line",
    "Rectangle",
    "SheetObjectComponent",
    "SheetObjectFilled",
    "SheetObjectGraph",
    "SheetObjectGraphic",
    "SheetObjectImage",
    "SheetObjectPath",
    "SheetObjectText"
  ]
};

// Attributes recognized by each source SAX callback (delegated readers audited separately).
export const gnumericAttributes: Readonly<Record<string, readonly string[]>> = {
  "Workbook": [
    "xmlns:gmr",
    "xmlns:gnm",
    "xmlns:xsi",
    "xsi:schemaLocation"
  ],
  "Version": [
    "Epoch",
    "Major",
    "Minor"
  ],
  "Attributes": [],
  "Attribute": [],
  "name": [],
  "value": [],
  "type": [],
  "Summary": [],
  "Item": [
    "Range",
    "ValueFormat",
    "ValueType"
  ],
  "val-string": [],
  "val-int": [],
  "SheetNameIndex": [],
  "SheetName": [
    "gnm:Cols",
    "gnm:Rows",
    "gnm:SheetType"
  ],
  "Names": [],
  "Name": [],
  "position": [],
  "Sheets": [],
  "Sheet": [
    "DisplayFormulas",
    "DisplayOutlines",
    "ExprConvention",
    "GridColor",
    "HideColHeader",
    "HideGrid",
    "HideRowHeader",
    "HideZero",
    "OutlineSymbolsBelow",
    "OutlineSymbolsRight",
    "Protected",
    "RTL_Layout",
    "TabColor",
    "TabTextColor",
    "Visibility"
  ],
  "MaxCol": [],
  "MaxRow": [],
  "Zoom": [],
  "PrintInformation": [],
  "PrintUnit": [],
  "Margins": [],
  "top": ["Points", "PrefUnit"],
  "bottom": ["Points", "PrefUnit"],
  "left": ["Points", "PrefUnit"],
  "right": ["Points", "PrefUnit"],
  "header": ["Points", "PrefUnit"],
  "footer": ["Points", "PrefUnit"],
  "vPageBreaks": [],
  "break": [
    "pos",
    "type"
  ],
  "hPageBreaks": [],
  "Scale": [
    "cols",
    "percentage",
    "rows",
    "type"
  ],
  "vcenter": [
    "value"
  ],
  "hcenter": [
    "value"
  ],
  "grid": [
    "value"
  ],
  "do_not_print": [
    "value"
  ],
  "print_range": [
    "value"
  ],
  "monochrome": [
    "value"
  ],
  "draft": [],
  "comments": [
    "placement"
  ],
  "errors": [
    "PrintErrorsAs"
  ],
  "titles": [
    "value"
  ],
  "repeat_top": [
    "value"
  ],
  "repeat_left": [
    "value"
  ],
  "Footer": [
    "Left",
    "Middle",
    "Right"
  ],
  "Header": [
    "Left",
    "Middle",
    "Right"
  ],
  "order": [],
  "paper": [],
  "print-to-uri": [],
  "orientation": [],
  "even_if_only_styles": [
    "value"
  ],
  "Styles": [],
  "StyleRegion": [
    "endCol",
    "endRow",
    "startCol",
    "startRow"
  ],
  "Style": [
    "Back",
    "Fit",
    "Fore",
    "Format",
    "HAlign",
    "Hidden",
    "Indent",
    "Locked",
    "Orient",
    "PatternColor",
    "Rotation",
    "Shade",
    "ShrinkToFit",
    "VAlign",
    "WrapText"
  ],
  "Font": [
    "Bold",
    "Italic",
    "Script",
    "StrikeThrough",
    "Underline",
    "Unit"
  ],
  "StyleBorder": [],
  "Top": [
    "Color",
    "Style"
  ],
  "Bottom": [
    "Color",
    "Style"
  ],
  "Left": [
    "Color",
    "Style"
  ],
  "Right": [
    "Color",
    "Style"
  ],
  "Diagonal": [
    "Color",
    "Style"
  ],
  "Rev-Diagonal": [
    "Color",
    "Style"
  ],
  "Validation": [
    "AllowBlank",
    "Message",
    "Operator",
    "Style",
    "Title",
    "Type",
    "UseDropdown"
  ],
  "Expression0": [],
  "Expression1": [],
  "HyperLink": [
    "target",
    "tip",
    "type"
  ],
  "InputMessage": [
    "Message",
    "Title"
  ],
  "Condition": [
    "Operator"
  ],
  "Cols": [
    "DefaultSizePts"
  ],
  "ColInfo": [
    "Collapsed",
    "Count",
    "HardSize",
    "Hidden",
    "MarginA",
    "MarginB",
    "No",
    "OutlineLevel",
    "Unit"
  ],
  "Rows": [
    "DefaultSizePts"
  ],
  "RowInfo": [
    "Collapsed",
    "Count",
    "HardSize",
    "Hidden",
    "MarginA",
    "MarginB",
    "No",
    "OutlineLevel",
    "Unit"
  ],
  "Selections": [
    "CursorCol",
    "CursorRow"
  ],
  "Selection": [
    "endCol",
    "endRow",
    "startCol",
    "startRow"
  ],
  "Cells": [],
  "Cell": [
    "Col",
    "Cols",
    "ExprID",
    "Row",
    "Rows",
    "Value",
    "ValueFormat",
    "ValueType"
  ],
  "Content": [],
  "MergedRegions": [],
  "Merge": [],
  "Filters": [],
  "Filter": [],
  "Field": [
    "Index",
    "IsAnd",
    "Op0",
    "Op1",
    "Type",
    "Value0",
    "Value1",
    "ValueType0",
    "ValueType1",
    "count",
    "items",
    "rel_range",
    "top"
  ],
  "SheetLayout": [
    "TopLeft"
  ],
  "FreezePanes": [
    "FrozenTopLeft",
    "UnfrozenTopLeft"
  ],
  "Solver": [
    "AutoScale",
    "Discr",
    "Inputs",
    "MaxIter",
    "MaxTime",
    "ModelType",
    "NonNeg",
    "ProblemType",
    "ProgramR",
    "SensitivityR",
    "Target",
    "TargetCol",
    "TargetRow"
  ],
  "Constr": [
    "Cols",
    "Lcol",
    "Lrow",
    "Rcol",
    "Rows",
    "Rrow",
    "Type",
    "lhs",
    "rhs"
  ],
  "Scenarios": [],
  "Scenario": [
    "Comment",
    "Name"
  ],
  "Objects": [],
  "Rectangle": [],
  "Ellipse": [],
  "Arrow": [],
  "Line": [],
  "GnmGraph": [],
  "CellComment": [],
  "SheetObjectGraphic": [],
  "SheetObjectFilled": [],
  "SheetObjectText": [],
  "SheetObjectGraph": [],
  "SheetObjectImage": [],
  "SheetObjectComponent": [],
  "SheetObjectPath": [],
  "Geometry": [
    "Height",
    "SelectedTab",
    "Width"
  ],
  "UIData": [
    "Height",
    "SelectedTab",
    "Width"
  ],
  "Calculation": [
    "DateConvention",
    "EnableIteration",
    "IterationTolerance",
    "ManualRecalc",
    "MaxIterations"
  ],
  "DateConvention": [],
  "GODoc": [],
  "document-meta": []
};

// Unnamespaced delegated subtrees: Gnumeric object callbacks and GOStyle/GogObject.
export const objectChildren: Readonly<Record<string, readonly string[]>> = {
  SheetObjectFilled: ["Style"], GnmSOFilled: ["Style"], Rectangle: ["Style"], Ellipse: ["Style"], SheetObjectText: ["Style"],
  SheetObjectGraphic: ["Style"], GnmSOLine: ["Style"], Arrow: ["Style"], Line: ["Style"],
  SheetObjectPath: ["Style", "Path"], GnmSOPath: ["Style", "Path"],
  SheetObjectImage: ["Content"], SheetObjectComponent: ["GOComponent"],
  SheetObjectGraph: ["GogObject"], GnmGraph: ["GogObject"],
  SheetWidgetButton: ["Style"], SheetWidgetList: ["Content"], SheetWidgetCombo: ["Content"],
  Style: ["line", "outline", "fill", "marker", "font", "text_layout"],
  fill: ["pattern", "gradient", "image"],
  GogObject: ["GogObject", "property", "data"], property: ["Style", "GogObject"], data: ["dimension"]
};
