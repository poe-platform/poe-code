// Gnumeric SAX child states, matching the production gnumeric-schema codec.
use super::{Element, Node, namespace};

fn accepted(parent: &str, child: &str) -> bool {
    match parent {
        "" => matches!(child, "Workbook"),
        "Workbook" => matches!(
            child,
            "Attributes"
                | "Calculation"
                | "DateConvention"
                | "Geometry"
                | "Names"
                | "SheetNameIndex"
                | "Sheets"
                | "Summary"
                | "UIData"
                | "Version"
        ),
        "Attributes" => matches!(child, "Attribute"),
        "Attribute" => matches!(child, "name" | "type" | "value"),
        "Summary" => matches!(child, "Item"),
        "Item" => matches!(child, "name" | "val-int" | "val-string"),
        "SheetNameIndex" => matches!(child, "SheetName"),
        "Names" => matches!(child, "Name"),
        "Name" => matches!(child, "name" | "position" | "value"),
        "Sheets" => matches!(child, "Sheet"),
        "Sheet" => matches!(
            child,
            "Cells"
                | "Cols"
                | "Filters"
                | "MaxCol"
                | "MaxRow"
                | "MergedRegions"
                | "Name"
                | "Names"
                | "Objects"
                | "PrintInformation"
                | "Rows"
                | "Scenarios"
                | "Selections"
                | "SheetLayout"
                | "Solver"
                | "Styles"
                | "Zoom"
        ),
        "PrintInformation" => matches!(
            child,
            "Footer"
                | "Header"
                | "Margins"
                | "PrintUnit"
                | "Scale"
                | "comments"
                | "do_not_print"
                | "draft"
                | "errors"
                | "even_if_only_styles"
                | "first_page_number"
                | "grid"
                | "hPageBreaks"
                | "hcenter"
                | "monochrome"
                | "order"
                | "orientation"
                | "paper"
                | "print-to-uri"
                | "print_range"
                | "repeat_left"
                | "repeat_top"
                | "titles"
                | "vPageBreaks"
                | "vcenter"
        ),
        "Margins" => matches!(
            child,
            "bottom" | "footer" | "header" | "left" | "right" | "top"
        ),
        "vPageBreaks" => matches!(child, "break"),
        "hPageBreaks" => matches!(child, "break"),
        "Styles" => matches!(child, "StyleRegion"),
        "StyleRegion" => matches!(child, "Style"),
        "Style" => matches!(
            child,
            "Condition" | "Font" | "HyperLink" | "InputMessage" | "StyleBorder" | "Validation"
        ),
        "StyleBorder" => matches!(
            child,
            "Bottom" | "Diagonal" | "Left" | "Rev-Diagonal" | "Right" | "Top"
        ),
        "Validation" => matches!(child, "Expression0" | "Expression1"),
        "Condition" => matches!(child, "Expression0" | "Expression1" | "Style"),
        "Cols" => matches!(child, "ColInfo"),
        "Rows" => matches!(child, "RowInfo"),
        "Selections" => matches!(child, "Selection"),
        "Cells" => matches!(child, "Cell"),
        "Cell" => matches!(child, "Content"),
        "MergedRegions" => matches!(child, "Merge"),
        "Filters" => matches!(child, "Filter"),
        "Filter" => matches!(child, "Field"),
        "SheetLayout" => matches!(child, "FreezePanes"),
        "Solver" => matches!(child, "Constr"),
        "Scenarios" => matches!(child, "Scenario"),
        "Scenario" => matches!(child, "Item"),
        "Objects" => matches!(
            child,
            "Arrow"
                | "CellComment"
                | "Ellipse"
                | "GnmGraph"
                | "Line"
                | "Rectangle"
                | "SheetObjectComponent"
                | "SheetObjectFilled"
                | "SheetObjectGraph"
                | "SheetObjectGraphic"
                | "SheetObjectImage"
                | "SheetObjectPath"
                | "SheetObjectText"
        ),
        _ => false,
    }
}

pub(super) fn read(node: &mut Element, path: &mut Vec<String>, diagnostics: &mut String) {
    let name = node.tag.rsplit(':').next().unwrap().to_owned();
    if path.last().is_some_and(|p| p == "Margins") && namespace(&node.namespace) {
        for (key, value) in &mut node.attrs {
            if key == "PrefUnit" {
                *value = match value.to_ascii_lowercase().as_str() {
                    "cm" | "mm" | "centimeter" | "millimeter" => "mm",
                    "inch" | "in" | "inches" => "inch",
                    _ => "points",
                }
                .into();
            }
        }
    }
    if name == "Calculation"
        && namespace(&node.namespace)
        && super::attr(node, "DateConvention")
            .is_some_and(|v| !matches!(v, "Apple:1904" | "Lotus:1900"))
    {
        diagnostics.push_str("Ignoring invalid date conventions.\n");
    }
    let leaf_name = name == "Name" && path.last().is_none_or(|p| p != "Names");
    path.push(name.clone());
    node.children.retain_mut(|child| {
        let Node::Element(child) = child else {
            return true;
        };
        let local = child.tag.rsplit(':').next().unwrap();
        if local == "document-meta"
            && child.namespace == "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
            || local == "GODoc" && child.namespace.is_empty()
            || name == "Objects"
        {
            return true;
        }
        if !leaf_name
            && (namespace(&child.namespace) && accepted(&name, local)
                || name == "Name"
                    && child.namespace.is_empty()
                    && matches!(local, "name" | "value" | "position"))
        {
            read(child, path, diagnostics);
            true
        } else {
            diagnostics.push_str(&format!(
                "Unexpected element '{}' in state : \n\t{}\n",
                child.tag,
                path.join(" -> ")
            ));
            false
        }
    });
    path.pop();
}
