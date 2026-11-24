//! Lossless text representation of the typed workbook. Cell batches are atomic
//! JSON arrays so a shared JSON document cannot merge half of two cell edits.
use super::{
    ColorScaleThreshold, ConditionalFormat, ConditionalIcon, ConditionalRule, ConditionalValue,
    DataBar, IconSet, IconThreshold, PivotFilter, PivotTable, PivotValue, Spreadsheet, TextOperator, ValueOperator, model::*,
};
use mcp_protocol_rust::json::Value as Json;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
type Result<T> = std::result::Result<T, String>;

fn string(s: &str) -> Json {
    Json::String(s.encode_utf16().collect())
}
fn object(fields: impl IntoIterator<Item = (&'static str, Json)>) -> Json {
    Json::Object(
        fields
            .into_iter()
            .filter(|(_, v)| !matches!(v, Json::Null))
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn field<'a>(value: &'a Json, key: &str) -> Result<&'a Json> {
    value
        .get(key)
        .ok_or_else(|| format!("Missing workbook field: {key}"))
}
fn items(value: &Json) -> Result<&[Json]> {
    if let Json::Array(items) = value {
        Ok(items)
    } else {
        Err("Expected workbook array".into())
    }
}
trait Codec: Sized {
    fn json(&self) -> Json;
    fn read(value: &Json) -> Result<Self>;
}
impl Codec for String {
    fn json(&self) -> Json {
        string(self)
    }
    fn read(value: &Json) -> Result<Self> {
        if let Json::String(s) = value {
            String::from_utf16(s).map_err(|_| "Invalid Unicode in workbook".into())
        } else {
            Err("Expected workbook text".into())
        }
    }
}
impl Codec for bool {
    fn json(&self) -> Json {
        Json::Bool(*self)
    }
    fn read(v: &Json) -> Result<Self> {
        if let Json::Bool(b) = v {
            Ok(*b)
        } else {
            Err("Expected boolean".into())
        }
    }
}
impl Codec for f64 {
    fn json(&self) -> Json {
        Json::Number(*self)
    }
    fn read(v: &Json) -> Result<Self> {
        if let Json::Number(n) = v {
            if n.is_finite() {
                return Ok(*n);
            }
        }
        Err("Expected finite number".into())
    }
}
macro_rules! integer {($($t:ty),*)=>{$(impl Codec for $t {
    fn json(&self)->Json {Json::Number(*self as f64)}
    fn read(v:&Json)->Result<Self> {let n=f64::read(v)?; if n.fract()!=0. || n < <$t>::MIN as f64 || n > (<$t>::MAX as f64).min(9_007_199_254_740_991.) {Err("Invalid workbook integer".into())}else{Ok(n as $t)}}
})*};}
integer!(usize, u64, u8, i64);
impl<T: Codec> Codec for Option<T> {
    fn json(&self) -> Json {
        self.as_ref().map_or(Json::Null, Codec::json)
    }
    fn read(v: &Json) -> Result<Self> {
        if matches!(v, Json::Null) {
            Ok(None)
        } else {
            T::read(v).map(Some)
        }
    }
}
impl<T: Codec> Codec for Vec<T> {
    fn json(&self) -> Json {
        Json::Array(self.iter().map(Codec::json).collect())
    }
    fn read(v: &Json) -> Result<Self> {
        items(v)?.iter().map(T::read).collect()
    }
}
impl<T: Codec + Ord> Codec for BTreeSet<T> {
    fn json(&self) -> Json {
        Json::Array(self.iter().map(Codec::json).collect())
    }
    fn read(v: &Json) -> Result<Self> {
        items(v)?.iter().map(T::read).collect()
    }
}
impl<T: Codec> Codec for Arc<T> {
    fn json(&self) -> Json {
        self.as_ref().json()
    }
    fn read(v: &Json) -> Result<Self> {
        T::read(v).map(Arc::new)
    }
}
impl<T: Codec, const N: usize> Codec for [T; N] {
    fn json(&self) -> Json {
        Json::Array(self.iter().map(Codec::json).collect())
    }
    fn read(v: &Json) -> Result<Self> {
        Vec::<T>::read(v)?
            .try_into()
            .map_err(|_| format!("Expected {N} elements"))
    }
}
macro_rules! tuple {($($t:ident:$i:tt),*)=>{impl<$($t:Codec),*> Codec for ($($t,)*) {
    fn json(&self)->Json {Json::Array(vec![$(self.$i.json()),*])}
    fn read(v:&Json)->Result<Self> {let a=items(v)?; if a.len()!=[$(stringify!($t)),*].len(){return Err("Invalid workbook tuple".into())} Ok(($($t::read(&a[$i])?,)*))}
}};}
tuple!(A:0,B:1);
tuple!(A:0,B:1,C:2);
trait Key: Sized + Ord {
    fn key(&self) -> String;
    fn from_key(s: &str) -> Result<Self>;
}
impl Key for String {
    fn key(&self) -> String {
        self.clone()
    }
    fn from_key(s: &str) -> Result<Self> {
        Ok(s.into())
    }
}
impl Key for usize {
    fn key(&self) -> String {
        self.to_string()
    }
    fn from_key(s: &str) -> Result<Self> {
        s.parse().map_err(|_| "Invalid workbook index".into())
    }
}
impl Key for (usize, usize) {
    fn key(&self) -> String {
        format!("{},{}", self.0, self.1)
    }
    fn from_key(s: &str) -> Result<Self> {
        let (a, b) = s.split_once(',').ok_or("Invalid cell coordinate")?;
        Ok((usize::from_key(a)?, usize::from_key(b)?))
    }
}
impl Key for (usize, usize, usize) {
    fn key(&self) -> String {
        format!("{},{},{}", self.0, self.1, self.2)
    }
    fn from_key(s: &str) -> Result<Self> {
        let (a, b) = s.split_once(',').ok_or("Invalid workbook coordinate")?;
        let (b, c) = <(usize, usize)>::from_key(b)?;
        Ok((usize::from_key(a)?, b, c))
    }
}
impl<K: Key, V: Codec> Codec for BTreeMap<K, V> {
    fn json(&self) -> Json {
        Json::Object(
            self.iter()
                .map(|(k, v)| (k.key().encode_utf16().collect(), v.json()))
                .collect(),
        )
    }
    fn read(v: &Json) -> Result<Self> {
        read_map(v, V::read)
    }
}
fn read_map<K: Key, V>(v: &Json, read: impl Fn(&Json) -> Result<V>) -> Result<BTreeMap<K, V>> {
    let Json::Object(fields) = v else {
        return Err("Expected workbook map".into());
    };
    let mut result = BTreeMap::new();
    for (k, v) in fields {
        let key = String::from_utf16(k).map_err(|_| "Invalid workbook key")?;
        if result.insert(K::from_key(&key)?, read(v)?).is_some() {
            return Err("Duplicate workbook key".into());
        }
    }
    Ok(result)
}
// These are the property names accepted by the shared typed Office model.
impl Codec for &'static str {
    fn json(&self) -> Json {
        string(self)
    }
    fn read(v: &Json) -> Result<Self> {
        let key = String::read(v)?;
        const KEYS: &[&str] = &[
            "Underline",
            "Script",
            "Bold",
            "Italic",
            "Fore",
            "Unit",
            "StrikeThrough",
            "Shade",
            "Back",
            "PatternColor",
            "Left",
            "Right",
            "Top",
            "Bottom",
            "Rotation",
            "HAlign",
            "VAlign",
            "WrapText",
            "ShrinkToFit",
            "Locked",
            "Hidden",
            "bold",
            "italic",
            "strikethrough",
            "outline",
            "shadow",
            "size",
            "family",
            "font-family-class",
            "font-charset",
            "color",
            "underline",
            "subscript",
            "superscript",
            "landscape",
            "portrait",
            "showGridLines",
            "showRowColHeaders",
            "showFormulas",
            "showZeros",
            "rightToLeft",
            "tabSelected",
            "equal",
            "notEqual",
            "lessThan",
            "lessThanOrEqual",
            "greaterThan",
            "greaterThanOrEqual",
        ];
        KEYS.iter()
            .copied()
            .find(|s| *s == key)
            .ok_or_else(|| format!("Unknown workbook property: {key}"))
    }
}
macro_rules! structure {($t:ty {$($f:ident),*})=>{impl Codec for $t {
    fn json(&self)->Json {object([$( (stringify!($f),self.$f.json()) ),*])}
    fn read(v:&Json)->Result<Self>{if !matches!(v,Json::Object(_)){return Err("Expected workbook object".into())} Ok(Self {$($f:Codec::read(v.get(stringify!($f)).unwrap_or(&Json::Null))?),*})}
}};}
structure!(Style {
    attributes,
    font,
    family,
    borders
});
fn style_json(style: &Option<Arc<Style>>, definitions: &BTreeMap<&Style, &str>) -> Json {
    style.as_ref().map_or(Json::Null, |style| {
        definitions
            .get(style.as_ref())
            .map_or_else(|| style.json(), |id| string(id))
    })
}
fn read_style(
    value: &Json,
    definitions: &BTreeMap<String, Arc<Style>>,
) -> Result<Option<Arc<Style>>> {
    if let Json::String(_) = value {
        let id = String::read(value)?;
        definitions
            .get(&id)
            .cloned()
            .map(Some)
            .ok_or_else(|| format!("Unknown workbook style: {id}"))
    } else {
        Option::<Arc<Style>>::read(value)
    }
}
impl Axis {
    fn json_styles(&self, definitions: &BTreeMap<&Style, &str>) -> Json {
        object([
            ("size", self.size.json()),
            ("hidden", self.hidden.json()),
            ("level", self.level.json()),
            ("style", style_json(&self.style, definitions)),
        ])
    }
    fn read_styles(v: &Json, definitions: &BTreeMap<String, Arc<Style>>) -> Result<Self> {
        if !matches!(v, Json::Object(_)) {
            return Err("Expected workbook object".into());
        }
        Ok(Self {
            size: Codec::read(v.get("size").unwrap_or(&Json::Null))?,
            hidden: Codec::read(v.get("hidden").unwrap_or(&Json::Null))?,
            level: Codec::read(v.get("level").unwrap_or(&Json::Null))?,
            style: read_style(v.get("style").unwrap_or(&Json::Null), definitions)?,
        })
    }
}
fn styled_map<K: Key, T>(values: &BTreeMap<K, T>, write: impl Fn(&T) -> Json) -> Json {
    Json::Object(
        values
            .iter()
            .map(|(k, v)| (k.key().encode_utf16().collect(), write(v)))
            .collect(),
    )
}
structure!(TextRun { text, attributes });
structure!(Comment {
    row,
    column,
    author,
    runs
});
structure!(Print {
    orientation,
    margins,
    scale
});
impl Codec for Filter {
    fn json(&self) -> Json {
        object([
            ("area", self.area.json()),
            ("fields", self.fields.json()),
            ("show_buttons", self.show_buttons.json()),
            ("column_visibility", self.column_visibility.json()),
        ])
    }
    fn read(v: &Json) -> Result<Self> {
        Ok(Self {
            area: Codec::read(field(v, "area")?)?,
            fields: Codec::read(field(v, "fields")?)?,
            show_buttons: Codec::read(field(v, "show_buttons")?)?,
            column_visibility: bool::read(
                v.get("column_visibility").unwrap_or(&Json::Bool(false)),
            )?,
        })
    }
}
structure!(TopFilter {
    rank,
    percent,
    bottom
});
impl Codec for FilterField {
    fn json(&self) -> Json {
        object([
            ("top", self.top.json()),
            (
                "date_groups",
                if self.date_groups.is_empty() {
                    Json::Null
                } else {
                    self.date_groups.json()
                },
            ),
            ("conditions", self.conditions.json()),
            ("hidden_rows", self.hidden_rows.json()),
            ("conjunction", self.conjunction.json()),
            ("custom", self.custom.json()),
        ])
    }
    fn read(v: &Json) -> Result<Self> {
        Ok(Self {
            top: Codec::read(v.get("top").unwrap_or(&Json::Null))?,
            date_groups: v
                .get("date_groups")
                .map(Codec::read)
                .transpose()?
                .unwrap_or_default(),
            conditions: Codec::read(field(v, "conditions")?)?,
            hidden_rows: Codec::read(v.get("hidden_rows").unwrap_or(&Json::Null))?,
            conjunction: Codec::read(field(v, "conjunction")?)?,
            custom: bool::read(v.get("custom").unwrap_or(&Json::Bool(false)))?,
        })
    }
}
structure!(CalculatedColumn {
    formula,
    array,
    origin_row
});
impl Codec for Table {
    fn json(&self) -> Json {
        object([
            ("name", self.name.json()),
            ("sheet", self.sheet.json()),
            ("area", self.area.json()),
            ("header", self.header.json()),
            ("filter", self.filter.json()),
            ("columns", self.columns.json()),
            ("calculated_columns", self.calculated_columns.json()),
            ("totals", self.totals.json()),
        ])
    }
    fn read(v: &Json) -> Result<Self> {
        Ok(Self {
            calculated_columns: v
                .get("calculated_columns")
                .map(BTreeMap::<usize, CalculatedColumn>::read)
                .transpose()?
                .unwrap_or_default(),
            name: String::read(field(v, "name")?)?,
            sheet: usize::read(field(v, "sheet")?)?,
            area: <[usize; 4]>::read(field(v, "area")?)?,
            header: bool::read(field(v, "header")?)?,
            filter: Option::<Filter>::read(v.get("filter").unwrap_or(&Json::Null))?,
            columns: v
                .get("columns")
                .map(Vec::<String>::read)
                .transpose()?
                .unwrap_or_default(),
            totals: v
                .get("totals")
                .map(bool::read)
                .transpose()?
                .unwrap_or(false),
        })
    }
}
structure!(Iteration {
    enabled,
    maximum,
    tolerance
});
structure!(CompiledName {
    expression,
    bindings
});
structure!(NamedExpression {
    name,
    sheet,
    expression,
    openformula,
    position,
    compiled
});
structure!(ArrayFormula<String>{range,expression,openformula,formula_display});
impl Sheet<String> {
    fn json_styles(&self, definitions: &BTreeMap<&Style, &str>) -> Json {
        object([
            ("name", self.name.json()),
            ("view", self.view.json()),
            ("print", self.print.json()),
            ("filter", self.filter.json()),
            (
                "cells",
                styled_map(&self.cells, |cell| {
                    cell.json_style(style_json(&cell.style, definitions))
                }),
            ),
            (
                "rows",
                styled_map(&self.rows, |axis| axis.json_styles(definitions)),
            ),
            (
                "columns",
                styled_map(&self.columns, |axis| axis.json_styles(definitions)),
            ),
            ("merges", self.merges.json()),
            ("arrays", self.arrays.json()),
            ("comments", self.comments.json()),
            ("empty_headers", self.empty_headers.json()),
            ("default_row_height", self.default_row_height.json()),
            ("default_column_width", self.default_column_width.json()),
            ("frozen_rows", self.frozen_rows.json()),
            ("frozen_columns", self.frozen_columns.json()),
        ])
    }
    fn read_styles(v: &Json, definitions: &BTreeMap<String, Arc<Style>>) -> Result<Self> {
        if !matches!(v, Json::Object(_)) {
            return Err("Expected workbook object".into());
        }
        Ok(Self {
            name: Codec::read(v.get("name").unwrap_or(&Json::Null))?,
            view: Codec::read(v.get("view").unwrap_or(&Json::Null))?,
            print: Codec::read(v.get("print").unwrap_or(&Json::Null))?,
            filter: Codec::read(v.get("filter").unwrap_or(&Json::Null))?,
            cells: read_map(v.get("cells").unwrap_or(&Json::Null), |value| {
                TypedCell::read_styles(value, definitions)
            })?,
            rows: read_map(v.get("rows").unwrap_or(&Json::Null), |value| {
                Axis::read_styles(value, definitions)
            })?,
            columns: read_map(v.get("columns").unwrap_or(&Json::Null), |value| {
                Axis::read_styles(value, definitions)
            })?,
            merges: Codec::read(v.get("merges").unwrap_or(&Json::Null))?,
            arrays: Codec::read(v.get("arrays").unwrap_or(&Json::Null))?,
            comments: Codec::read(v.get("comments").unwrap_or(&Json::Null))?,
            empty_headers: Codec::read(v.get("empty_headers").unwrap_or(&Json::Null))?,
            default_row_height: Codec::read(v.get("default_row_height").unwrap_or(&Json::Null))?,
            default_column_width: Codec::read(
                v.get("default_column_width").unwrap_or(&Json::Null),
            )?,
            frozen_rows: Option::<usize>::read(v.get("frozen_rows").unwrap_or(&Json::Null))?
                .unwrap_or(0),
            frozen_columns: Option::<usize>::read(v.get("frozen_columns").unwrap_or(&Json::Null))?
                .unwrap_or(0),
        })
    }
}
structure!(PivotValue { field, aggregate, name });
structure!(PivotFilter { field, selected });
structure!(PivotTable { name, sheet, row, column, source_sheet, source, rows, columns, values, filters, row_totals, column_totals });

impl Codec for Workbook {
    fn json(&self) -> Json {
        object([
            (
                "styles",
                if self.styles.is_empty() {
                    Json::Null
                } else {
                    self.styles.json()
                },
            ),
            ("default_style", self.default_style.json()),
            ("case_insensitive", self.case_insensitive.json()),
            ("date1904", self.date1904.json()),
            ("recalculate", self.recalculate.json()),
            ("lookup_search", self.lookup_search.json()),
            ("lookup_substring", self.lookup_substring.json()),
            ("string_ref_syntax", self.string_ref_syntax.json()),
            ("iteration", self.iteration.json()),
            ("names", self.names.json()),
            ("name_dependencies", self.name_dependencies.json()),
            ("name_uses", self.name_uses.json()),
            ("tables", self.tables.json()),
            ("pivots", if self.pivots.is_empty() { Json::Null } else { self.pivots.json() }),
            ("formula_origins", self.formula_origins.json()),
            ("uninterned_arrays", self.uninterned_arrays.json()),
            (
                "explicit_formula_styles",
                self.explicit_formula_styles.json(),
            ),
            ("conditional_formats", self.conditional_formats.json()),
        ])
    }
    fn read(v: &Json) -> Result<Self> {
        if !matches!(v, Json::Object(_)) {
            return Err("Expected workbook object".into());
        }
        Ok(Self {
            styles: v
                .get("styles")
                .map(BTreeMap::read)
                .transpose()?
                .unwrap_or_default(),
            default_style: Codec::read(v.get("default_style").unwrap_or(&Json::Null))?,
            case_insensitive: Codec::read(v.get("case_insensitive").unwrap_or(&Json::Null))?,
            date1904: Codec::read(v.get("date1904").unwrap_or(&Json::Null))?,
            recalculate: Codec::read(v.get("recalculate").unwrap_or(&Json::Null))?,
            lookup_search: Codec::read(v.get("lookup_search").unwrap_or(&Json::Null))?,
            lookup_substring: Codec::read(v.get("lookup_substring").unwrap_or(&Json::Null))?,
            string_ref_syntax: Codec::read(v.get("string_ref_syntax").unwrap_or(&Json::Null))?,
            iteration: Codec::read(v.get("iteration").unwrap_or(&Json::Null))?,
            names: Codec::read(v.get("names").unwrap_or(&Json::Null))?,
            name_dependencies: Codec::read(v.get("name_dependencies").unwrap_or(&Json::Null))?,
            name_uses: Codec::read(v.get("name_uses").unwrap_or(&Json::Null))?,
            tables: Codec::read(v.get("tables").unwrap_or(&Json::Null))?,
            pivots: v.get("pivots").map(BTreeMap::read).transpose()?.unwrap_or_default(),
            formula_origins: Codec::read(v.get("formula_origins").unwrap_or(&Json::Null))?,
            uninterned_arrays: Codec::read(v.get("uninterned_arrays").unwrap_or(&Json::Null))?,
            explicit_formula_styles: Codec::read(
                v.get("explicit_formula_styles").unwrap_or(&Json::Null),
            )?,
            conditional_formats: v
                .get("conditional_formats")
                .map(Vec::read)
                .transpose()?
                .unwrap_or_default(),
        })
    }
}
structure!(ConditionalFormat {
    sheet,
    ranges,
    priority,
    stop_if_true,
    rule,
    style,
    format
});
structure!(ConditionalIcon { set, index });
structure!(IconThreshold {
    value,
    greater_equal
});
structure!(IconSet {
    name,
    thresholds,
    reverse,
    show_value,
    custom
});
structure!(ColorScaleThreshold { value, color });
impl Codec for DataBar {
    fn json(&self) -> Json {
        object([
            ("min", self.min.json()),
            ("max", self.max.json()),
            ("positive_color", self.positive_color.json()),
            ("negative_color", self.negative_color.json()),
            ("border_color", self.border_color.json()),
            ("negative_border_color", self.negative_border_color.json()),
            ("axis_color", self.axis_color.json()),
            ("is_gradient", self.is_gradient.json()),
            ("show_value", self.show_value.json()),
            ("min_length", self.min_length.json()),
            ("max_length", self.max_length.json()),
            (
                "direction",
                if self.direction == "context" {
                    Json::Null
                } else {
                    self.direction.json()
                },
            ),
            (
                "axis",
                if self.axis == "automatic" {
                    Json::Null
                } else {
                    self.axis.json()
                },
            ),
        ])
    }
    fn read(v: &Json) -> Result<Self> {
        if !matches!(v, Json::Object(_)) {
            return Err("Expected data bar object".into());
        }
        Ok(Self {
            min: Codec::read(v.get("min").unwrap_or(&Json::Null))?,
            max: Codec::read(v.get("max").unwrap_or(&Json::Null))?,
            positive_color: Codec::read(v.get("positive_color").unwrap_or(&Json::Null))?,
            negative_color: Codec::read(v.get("negative_color").unwrap_or(&Json::Null))?,
            border_color: Codec::read(v.get("border_color").unwrap_or(&Json::Null))?,
            negative_border_color: Codec::read(
                v.get("negative_border_color").unwrap_or(&Json::Null),
            )?,
            axis_color: Codec::read(v.get("axis_color").unwrap_or(&Json::Null))?,
            is_gradient: Codec::read(v.get("is_gradient").unwrap_or(&Json::Null))?,
            show_value: Codec::read(v.get("show_value").unwrap_or(&Json::Null))?,
            min_length: Codec::read(v.get("min_length").unwrap_or(&Json::Null))?,
            max_length: Codec::read(v.get("max_length").unwrap_or(&Json::Null))?,
            direction: v
                .get("direction")
                .map(String::read)
                .transpose()?
                .unwrap_or_else(|| "context".into()),
            axis: v
                .get("axis")
                .map(String::read)
                .transpose()?
                .unwrap_or_else(|| "automatic".into()),
        })
    }
}
impl Codec for ConditionalValue {
    fn json(&self) -> Json {
        match self {
            Self::Min => object([("type", string("Min"))]),
            Self::Max => object([("type", string("Max"))]),
            Self::Number(n) => object([("type", string("Number")), ("value", n.json())]),
            Self::Percent(n) => object([("type", string("Percent")), ("value", n.json())]),
            Self::Percentile(n) => object([("type", string("Percentile")), ("value", n.json())]),
            Self::Formula(s) => object([("type", string("Formula")), ("value", s.json())]),
        }
    }
    fn read(v: &Json) -> Result<Self> {
        match String::read(field(v, "type")?)?.as_str() {
            "Min" => Ok(Self::Min),
            "Max" => Ok(Self::Max),
            "Number" => Ok(Self::Number(Codec::read(field(v, "value")?)?)),
            "Percent" => Ok(Self::Percent(Codec::read(field(v, "value")?)?)),
            "Percentile" => Ok(Self::Percentile(Codec::read(field(v, "value")?)?)),
            "Formula" => Ok(Self::Formula(Codec::read(field(v, "value")?)?)),
            _ => Err("Unknown conditional formatting threshold".into()),
        }
    }
}
impl Codec for ConditionalRule {
    fn json(&self) -> Json {
        match self {
            Self::TimePeriod { period } => {
                object([("type", string("TimePeriod")), ("period", period.json())])
            }
            Self::IconSet(set) => object([("type", string("IconSet")), ("set", set.json())]),
            Self::DataBar(bar) => object([("type", string("DataBar")), ("bar", bar.json())]),
            Self::ColorScale { thresholds } => object([
                ("type", string("ColorScale")),
                ("thresholds", thresholds.json()),
            ]),
            Self::Formula(formula) => {
                object([("type", string("Formula")), ("formula", formula.json())])
            }
            Self::Text { operator, value } => object([
                ("type", string("Text")),
                ("operator", operator.json()),
                ("value", value.json()),
            ]),
            Self::Top {
                rank,
                percent,
                bottom,
            } => object([
                ("type", string("Top")),
                ("rank", rank.json()),
                ("percent", percent.json()),
                ("bottom", bottom.json()),
            ]),
            Self::DuplicateValues => object([("type", string("DuplicateValues"))]),
            Self::UniqueValues => object([("type", string("UniqueValues"))]),
            Self::AverageDeviation {
                above,
                equal,
                deviations,
            } => object([
                ("type", string("AverageDeviation")),
                ("above", above.json()),
                ("equal", equal.json()),
                ("deviations", deviations.json()),
            ]),
            Self::AboveAverage => object([("type", string("AboveAverage"))]),
            Self::BelowAverage => object([("type", string("BelowAverage"))]),
            Self::AboveOrEqualAverage => object([("type", string("AboveOrEqualAverage"))]),
            Self::BelowOrEqualAverage => object([("type", string("BelowOrEqualAverage"))]),
            Self::Blanks => object([("type", string("Blanks"))]),
            Self::NotBlanks => object([("type", string("NotBlanks"))]),
            Self::Errors => object([("type", string("Errors"))]),
            Self::NoErrors => object([("type", string("NoErrors"))]),
            Self::CellIs {
                operator,
                formula,
                formula2,
            } => object([
                ("type", string("CellIs")),
                ("operator", operator.json()),
                ("formula", formula.json()),
                ("formula2", formula2.json()),
            ]),
        }
    }
    fn read(v: &Json) -> Result<Self> {
        match String::read(field(v, "type")?)?.as_str() {
            "TimePeriod" => Ok(Self::TimePeriod {
                period: Codec::read(field(v, "period")?)?,
            }),
            "IconSet" => Ok(Self::IconSet(Codec::read(field(v, "set")?)?)),
            "DataBar" => Ok(Self::DataBar(Codec::read(field(v, "bar")?)?)),
            "ColorScale" => Ok(Self::ColorScale {
                thresholds: Codec::read(field(v, "thresholds")?)?,
            }),
            "Formula" => Ok(Self::Formula(Codec::read(field(v, "formula")?)?)),
            "Text" => Ok(Self::Text {
                operator: Codec::read(field(v, "operator")?)?,
                value: Codec::read(field(v, "value")?)?,
            }),
            "Top" => Ok(Self::Top {
                rank: Codec::read(field(v, "rank")?)?,
                percent: Codec::read(field(v, "percent")?)?,
                bottom: Codec::read(field(v, "bottom")?)?,
            }),
            "DuplicateValues" => Ok(Self::DuplicateValues),
            "UniqueValues" => Ok(Self::UniqueValues),
            "AverageDeviation" => Ok(Self::AverageDeviation {
                above: Codec::read(field(v, "above")?)?,
                equal: Codec::read(field(v, "equal")?)?,
                deviations: Codec::read(field(v, "deviations")?)?,
            }),
            "AboveAverage" => Ok(Self::AboveAverage),
            "BelowAverage" => Ok(Self::BelowAverage),
            "AboveOrEqualAverage" => Ok(Self::AboveOrEqualAverage),
            "BelowOrEqualAverage" => Ok(Self::BelowOrEqualAverage),
            "Blanks" => Ok(Self::Blanks),
            "NotBlanks" => Ok(Self::NotBlanks),
            "Errors" => Ok(Self::Errors),
            "NoErrors" => Ok(Self::NoErrors),
            "CellIs" => Ok(Self::CellIs {
                operator: Codec::read(field(v, "operator")?)?,
                formula: Codec::read(field(v, "formula")?)?,
                formula2: Codec::read(v.get("formula2").unwrap_or(&Json::Null))?,
            }),
            _ => Err("Unknown conditional formatting rule".into()),
        }
    }
}

macro_rules! enumeration {($t:ty {$($v:ident),*})=>{impl Codec for $t {
    fn json(&self)->Json {string(match self {$(Self::$v=>stringify!($v)),*})}
    fn read(v:&Json)->Result<Self>{match String::read(v)?.as_str() {$(stringify!($v)=>Ok(Self::$v),)* _=>Err("Unknown workbook setting".into())}}
}};}
enumeration!(TextOperator {
    Contains,
    DoesNotContain,
    BeginsWith,
    EndsWith,
    Equals
});
enumeration!(ValueOperator {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Between,
    NotBetween
});
enumeration!(LookupSearch {
    Literal,
    Wildcard,
    Regex
});
enumeration!(StringRefSyntax {
    CalcA1,
    ExcelA1,
    ExcelR1C1,
    CalcExcelA1
});
impl Codec for Scale {
    fn json(&self) -> Json {
        match self {
            Self::Percentage(n) => object([("percent", n.json())]),
            Self::Fit(w, h) => object([("fit", (w.to_owned(), h.to_owned()).json())]),
        }
    }
    fn read(v: &Json) -> Result<Self> {
        if let Some(n) = v.get("percent") {
            Ok(Self::Percentage(f64::read(n)?))
        } else {
            let (w, h) = <(f64, f64)>::read(field(v, "fit")?)?;
            Ok(Self::Fit(w, h))
        }
    }
}
impl Codec for Value<String> {
    fn json(&self) -> Json {
        match self {
            Self::Empty => object([("type", string("empty"))]),
            Self::Text(s) => object([("type", string("text")), ("value", s.json())]),
            Self::Number(n) => object([("type", string("number")), ("value", n.json())]),
            Self::Bool(b) => object([("type", string("boolean")), ("value", b.json())]),
            Self::Error(e) => object([("type", string("error")), ("value", e.json())]),
        }
    }
    fn read(v: &Json) -> Result<Self> {
        Ok(match String::read(field(v, "type")?)?.as_str() {
            "empty" => Self::Empty,
            "text" => Self::Text(String::read(field(v, "value")?)?),
            "number" => Self::Number(f64::read(field(v, "value")?)?),
            "boolean" => Self::Bool(bool::read(field(v, "value")?)?),
            "error" => Self::Error(String::read(field(v, "value")?)?),
            _ => return Err("Unknown cell value type".into()),
        })
    }
}
impl Codec for TypedCell<String> {
    fn json(&self) -> Json {
        self.json_style(self.style.json())
    }
    fn read(v: &Json) -> Result<Self> {
        Self::read_styles(v, &BTreeMap::new())
    }
}
impl TypedCell<String> {
    fn json_style(&self, style: Json) -> Json {
        // Excel formulas normally repeat the same expression with a dialect
        // prefix. Store its syntax once rather than duplicating the expression
        // and every collaborative reference bound to it.
        let excel = self.formula.as_deref().is_some_and(|formula| {
            self.openformula
                .as_deref()
                .and_then(|s| s.strip_prefix("msoxl:="))
                == Some(formula)
        });
        Json::Array(vec![object([
            (
                "value",
                if self.formula.is_some() {
                    Json::Null
                } else {
                    self.value.json()
                },
            ),
            ("formula", self.formula.json()),
            (
                "legacy_formula",
                if self.legacy_formula && self.formula.is_some() {
                    Json::Bool(true)
                } else {
                    Json::Null
                },
            ),
            (
                "openformula",
                if excel {
                    Json::Null
                } else {
                    self.openformula.json()
                },
            ),
            ("syntax", if excel { string("excel") } else { Json::Null }),
            ("formula_display", self.formula_display.json()),
            ("format", self.format.json()),
            (
                "value_format",
                if self.formula.is_some() {
                    Json::Null
                } else {
                    self.value_format.json()
                },
            ),
            ("style", style),
            ("rich_text", self.rich_text.json()),
        ])])
    }
    fn read_styles(v: &Json, definitions: &BTreeMap<String, Arc<Style>>) -> Result<Self> {
        let a = items(v)?;
        if a.len() != 1 {
            return Err("Expected one atomic cell batch".into());
        }
        let v = &a[0];
        if !matches!(v, Json::Object(_)) {
            return Err("Expected cell object".into());
        }
        macro_rules! optional {
            ($name:ident) => {
                Codec::read(v.get(stringify!($name)).unwrap_or(&Json::Null))?
            };
        }
        let formula: Option<String> = optional!(formula);
        let openformula = if let Some(syntax) = v.get("syntax") {
            if String::read(syntax)? != "excel"
                || v.get("openformula").is_some_and(|v| *v != Json::Null)
            {
                return Err("Invalid cell formula syntax".into());
            }
            Some(format!(
                "msoxl:={}",
                formula
                    .as_deref()
                    .ok_or("Formula syntax requires a formula")?
            ))
        } else {
            optional!(openformula)
        };
        Ok(Self {
            value: optional!(value),
            legacy_formula: Option::<bool>::read(v.get("legacy_formula").unwrap_or(&Json::Null))?
                .unwrap_or(false),
            formula,
            openformula,
            formula_display: optional!(formula_display),
            format: optional!(format),
            value_format: optional!(value_format),
            style: read_style(v.get("style").unwrap_or(&Json::Null), definitions)?,
            rich_text: optional!(rich_text),
        })
    }
}
impl Style {
    pub fn to_json(&self) -> Json {
        self.json()
    }
}
impl ConditionalFormat {
    pub fn to_json(&self) -> Json {
        self.json()
    }
    /// Decode one rule; `set_conditional_formats` validates it against a workbook.
    pub fn from_json(value: &Json) -> Result<Self> {
        Self::read(value)
    }
}

impl TypedCell<String> {
    pub fn to_json(&self) -> Json {
        self.json()
    }
    pub fn from_json(value: &Json) -> Result<Self> {
        Self::read(value)
    }
}
impl Spreadsheet {
    /// Decode an atomic cell, including references to this workbook's imported styles.
    pub fn cell_from_json(&self, value: &Json) -> Result<TypedCell<String>> {
        TypedCell::read_styles(value, &self.options.styles)
    }
    pub(super) fn intern_import_styles(&mut self, mut work: usize) -> Result<()> {
        let mut styles = BTreeMap::<&Style, (usize, &Arc<Style>)>::new();
        for sheet in &self.sheets {
            for style in sheet.cells.values().filter_map(|c| c.style.as_ref()).chain(
                sheet
                    .rows
                    .values()
                    .chain(sheet.columns.values())
                    .filter_map(|a| a.style.as_ref()),
            ) {
                work = work
                    .checked_sub(
                        style.retained_bytes()
                            + std::mem::size_of::<(&Style, (usize, &Arc<Style>))>(),
                    )
                    .ok_or("Imported styles exceed their limit")?;
                styles.entry(style).or_insert((0, style)).0 += 1;
            }
        }
        self.options.styles = styles
            .into_values()
            .filter(|(count, _)| *count > 1)
            .enumerate()
            .map(|(index, (_, style))| (format!("style{index}"), style.clone()))
            .collect();
        Ok(())
    }
    pub fn to_json(&self) -> Json {
        let definitions = self
            .options
            .styles
            .iter()
            .map(|(id, style)| (style.as_ref(), id.as_str()))
            .collect();
        object([
            (
                "sheets",
                Json::Array(
                    self.sheets
                        .iter()
                        .map(|s| s.json_styles(&definitions))
                        .collect(),
                ),
            ),
            ("options", self.options.json()),
        ])
    }
    pub fn from_json(value: &Json, limit: usize) -> Result<Self> {
        // Bound the typed allocation as well as calculation when accepting a shared document.
        let mut work = limit;
        let mut pending = vec![value];
        while let Some(v) = pending.pop() {
            work = work.checked_sub(128).ok_or("Workbook exceeds limit")?;
            match v {
                Json::Array(a) => pending.extend(a),
                Json::Object(o) => {
                    for (key, v) in o {
                        work = work
                            .checked_sub(key.len().saturating_mul(2))
                            .ok_or("Workbook exceeds limit")?;
                        pending.push(v);
                    }
                }
                Json::String(s) => {
                    work = work
                        .checked_sub(s.len().saturating_mul(2))
                        .ok_or("Workbook exceeds limit")?;
                }
                _ => {}
            }
        }
        let options = Workbook::read(field(value, "options")?)?;
        let mut book = Self {
            spills: Default::default(),
            sheets: items(field(value, "sheets")?)?
                .iter()
                .map(|s| Sheet::read_styles(s, &options.styles))
                .collect::<Result<_>>()?,
            options,
        };
        if book.sheets.is_empty() {
            return Err("Workbook must have at least one sheet".into());
        }
        let mut names = BTreeSet::new();
        for sheet in &book.sheets {
            if !super::valid_sheet_name(&sheet.name)
                || sheet.name.chars().count() > 31
                || !names.insert(super::case_fold::sheet_key(&sheet.name))
            {
                return Err("Invalid or duplicate sheet name".into());
            }
            if sheet
                .cells
                .keys()
                .any(|&(r, c)| r >= 1_048_576 || c >= 16_384)
            {
                return Err("Cell is outside the worksheet".into());
            }
        }
        let extent = |[r, c, w, h]: [usize; 4]| {
            w > 0 && h > 0 && r < 1_048_576 && c < 16_384 && h <= 1_048_576 - r && w <= 16_384 - c
        };
        let area = |[top, left, bottom, right]: [usize; 4]| {
            top <= bottom && left <= right && bottom < 1_048_576 && right < 16_384
        };
        let coord =
            |(s, r, c): (usize, usize, usize)| s < book.sheets.len() && r < 1_048_576 && c < 16_384;
        for sheet in &book.sheets {
            if sheet.frozen_rows >= 1_048_576
                || sheet.frozen_columns >= 16_384
                || [sheet.default_row_height, sheet.default_column_width]
                    .into_iter()
                    .flatten()
                    .any(|n| !n.is_finite() || n <= 0.)
                || sheet.merges.iter().any(|r| !extent(*r))
                || sheet.arrays.iter().any(|a| !extent(a.range))
                || sheet.rows.keys().any(|r| *r >= 1_048_576)
                || sheet.columns.keys().any(|c| *c >= 16_384)
                || sheet
                    .rows
                    .values()
                    .chain(sheet.columns.values())
                    .any(|a| a.size.is_some_and(|n| n < 0.))
                || sheet
                    .comments
                    .iter()
                    .any(|c| c.row >= 1_048_576 || c.column >= 16_384)
                || sheet
                    .filter
                    .as_ref()
                    .is_some_and(|f| !super::editor_filter::valid(f))
            {
                return Err("Invalid worksheet geometry".into());
            }
            for array in &sheet.arrays {
                let [r, c, w, h] = array.range;
                let count = w.checked_mul(h).ok_or("Array exceeds limit")?;
                work = work
                    .checked_sub(count.checked_mul(256).ok_or("Array exceeds limit")?)
                    .ok_or("Array exceeds limit")?;
                if (r..r + h)
                    .any(|row| (c..c + w).any(|col| !sheet.cells.contains_key(&(row, col))))
                {
                    return Err("Array formula is missing cells".into());
                }
            }
        }
        book.validate_conditional_formats(&book.options.conditional_formats, &mut work)?;
        book.validate_pivots(&mut work)?;
        let mut table_names = BTreeSet::new();
        if book.options.tables.iter().any(|t| {
            let mut columns = BTreeSet::new();
            !super::editor_tables::valid_table_name(&t.name)
                || !table_names.insert(super::case_fold::sheet_key(&t.name))
                || !t.columns.is_empty()
                    && (t.area[3]
                        .checked_sub(t.area[1])
                        .and_then(|n| n.checked_add(1))
                        != Some(t.columns.len())
                        || t.columns.iter().any(|name| {
                            name.is_empty() || !columns.insert(super::case_fold::sheet_key(name))
                        }))
                || t.area[2]
                    .checked_sub(t.area[0])
                    .and_then(|n| n.checked_add(1))
                    .is_none_or(|height| height < usize::from(t.header) + usize::from(t.totals))
                || t.calculated_columns.keys().any(|&column| {
                    t.area[3]
                        .checked_sub(t.area[1])
                        .is_none_or(|width| column > width)
                })
                || t.calculated_columns
                    .values()
                    .any(|definition| definition.origin_row.is_some_and(|row| row >= 1_048_576))
                || t.sheet >= book.sheets.len()
                || !area(t.area)
                || t.filter
                    .as_ref()
                    .is_some_and(|f| !super::editor_filter::valid(f))
        }) || book.options.names.iter().any(|n| {
            n.sheet.is_some_and(|s| s >= book.sheets.len()) || n.position.0 >= book.sheets.len()
        }) || book
            .options
            .formula_origins
            .iter()
            .any(|(a, b)| !coord(*a) || !coord(*b))
            || book
                .options
                .explicit_formula_styles
                .iter()
                .chain(&book.options.uninterned_arrays)
                .any(|c| !coord(*c))
            || book.options.name_dependencies.iter().any(|(n, refs)| {
                *n >= book.options.names.len()
                    || refs.iter().any(|n| *n >= book.options.names.len())
            })
        {
            return Err("Invalid workbook reference".into());
        }
        book.options.recalculate = true;
        book.spills = super::formulas::cache(&mut book.sheets, &book.options, None, work, true)
            .ok_or("Workbook calculation exceeds limit")?;
        book.prepare_filter_snapshots(work)?;
        Ok(book)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_roundtrip_preserves_styles_arrays_names_tables_and_comments() {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "8")], 10_000_000).unwrap();
        let sheet = &mut book.sheets[0];
        sheet.cells.get_mut(&(0, 0)).unwrap().style = Some(Arc::new(Style {
            font: vec![("Bold", "1".into())],
            attributes: vec![("Back", "FF0044AA".into())],
            family: "Arial".into(),
            borders: vec![("Left", 1, "FF000000".into())],
        }));
        sheet.columns.insert(
            0,
            Axis {
                size: Some(120.),
                hidden: false,
                level: 0,
                style: None,
            },
        );
        sheet.merges.push([2, 0, 2, 1]);
        sheet.comments.push(Comment {
            row: 0,
            column: 0,
            author: "Ada".into(),
            runs: vec![TextRun {
                text: "Note".into(),
                attributes: Arc::new(vec![("bold", "1".into())]),
            }],
        });
        book.options.names.push(NamedExpression {
            name: "Total".into(),
            sheet: None,
            expression: "Sheet1!A1".into(),
            openformula: None,
            position: (0, 0, 0),
            compiled: None,
        });
        book.options.tables.push(Table {
            calculated_columns: Default::default(),
            columns: Vec::new(),
            totals: false,
            name: "Data".into(),
            sheet: 0,
            area: [0, 0, 3, 1],
            header: true,
            filter: Some(Filter {
                column_visibility: false,
                area: [0, 0, 3, 1],
                fields: Some(BTreeMap::from([(
                    0,
                    FilterField {
                        date_groups: Vec::new(),
                        top: None,
                        hidden_rows: None,
                        custom: false,
                        conditions: vec![("equal", "8".into())],
                        conjunction: false,
                    },
                )])),
                show_buttons: true,
            }),
        });
        // Imported workbooks populate their derived column masks before saving.
        book.prepare_filter_snapshots(10_000_000).unwrap();
        let json = book.to_json();
        assert_eq!(
            Spreadsheet::from_json(&json, 10_000_000).unwrap().to_json(),
            json
        );
    }

    #[test]
    fn rejects_geometry_that_could_overflow_or_address_missing_sheets() {
        let mut book = Spreadsheet::new();
        book.sheets[0].merges.push([1_048_575, 0, 2, 2]);
        assert!(Spreadsheet::from_json(&book.to_json(), 10_000_000).is_err());
        book.sheets[0].merges.clear();
        book.options.tables.push(Table {
            calculated_columns: Default::default(),
            columns: Vec::new(),
            totals: false,
            name: "Broken".into(),
            sheet: 3,
            area: [0, 0, 1, 1],
            header: true,
            filter: None,
        });
        assert!(Spreadsheet::from_json(&book.to_json(), 10_000_000).is_err());
    }
    #[test]
    fn imported_style_references_share_memory_and_keep_edits_independent() {
        let mut source = Spreadsheet::new();
        source
            .edit(
                &[(0, 0, 0, "8"), (0, 0, 1, "9"), (0, 0, 2, "=A1+B1")],
                10_000_000,
            )
            .unwrap();
        let style = Arc::new(Style {
            font: vec![("Bold", "1".into())],
            family: "Calibri".into(),
            attributes: vec![("Fore", "FF663399".into()), ("WrapText", "1".into())],
            borders: vec![("Bottom", 1, "FF445566".into())],
        });
        for cell in source.sheets[0].cells.values_mut() {
            cell.style = Some(style.clone());
        }
        source.sheets[0].rows.insert(
            0,
            Axis {
                size: Some(30.),
                hidden: false,
                level: 0,
                style: Some(style.clone()),
            },
        );
        source.sheets[0].columns.insert(
            6,
            Axis {
                size: Some(100.),
                hidden: false,
                level: 0,
                style: Some(style),
            },
        );
        let imported =
            Spreadsheet::import_xlsx(&source.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
        let document = imported.to_json();
        let mut book = Spreadsheet::from_json(&document, 10_000_000).unwrap();
        assert_eq!(book.to_json(), document);
        let cells = &book.sheets[0].cells;
        assert!(Arc::ptr_eq(
            cells[&(0, 0)].style.as_ref().unwrap(),
            cells[&(0, 1)].style.as_ref().unwrap()
        ));
        assert!(Arc::ptr_eq(
            cells[&(0, 0)].style.as_ref().unwrap(),
            book.sheets[0].columns[&6].style.as_ref().unwrap()
        ));
        let expected = cells[&(0, 1)].style.clone();
        let registry = document
            .get("options")
            .unwrap()
            .get("styles")
            .unwrap()
            .clone();
        let mut cell = cells[&(0, 0)].clone();
        Arc::make_mut(cell.style.as_mut().unwrap())
            .font
            .retain(|(k, _)| *k != "Bold");
        book.replace_cells(vec![(0, 0, 0, Some(cell))], 10_000_000)
            .unwrap();
        assert!(
            book.sheets[0].cells[&(0, 0)]
                .style
                .as_ref()
                .unwrap()
                .font
                .iter()
                .all(|(k, _)| *k != "Bold")
        );
        assert!(book.sheets[0].cells[&(0, 1)].style == expected);
        assert_eq!(
            book.to_json().get("options").unwrap().get("styles"),
            Some(&registry)
        );
        assert_eq!(book.display(0, 0, 2, 100_000).unwrap(), "17");
        let reopened = Spreadsheet::from_json(&book.to_json(), 10_000_000).unwrap();
        assert_eq!(reopened.to_json(), book.to_json());
        let excel =
            Spreadsheet::import_xlsx(&book.export_xlsx(10_000_000).unwrap(), 10_000_000).unwrap();
        assert!(excel.sheets[0].cells[&(0, 1)].style == expected);
        let excel_style = excel.sheets[0].cells[&(0, 0)].style.as_ref().unwrap();
        let edited_style = book.sheets[0].cells[&(0, 0)].style.as_ref().unwrap();
        assert_eq!(excel_style.family, edited_style.family);
        assert_eq!(excel_style.attributes, edited_style.attributes);
        assert_eq!(excel_style.borders, edited_style.borders);
        assert!(
            excel_style
                .font
                .iter()
                .all(|(k, v)| *k != "Bold" || v != "1")
        );
    }

    #[test]
    fn style_references_do_not_escape_standalone_cell_json_or_lose_unused_definitions() {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "3"), (0, 1, 0, "5")], 1_000_000)
            .unwrap();
        let style = Arc::new(Style {
            family: "Arial".into(),
            ..Style::default()
        });
        for cell in book.sheets[0].cells.values_mut() {
            cell.style = Some(style.clone());
        }
        let legacy = book.to_json();
        assert!(legacy.get("options").unwrap().get("styles").is_none());
        assert_eq!(
            Spreadsheet::from_json(&legacy, 1_000_000)
                .unwrap()
                .to_json(),
            legacy
        );
        assert!(book.intern_import_styles(1).is_err());
        assert_eq!(book.to_json(), legacy);
        book.intern_import_styles(1_000_000).unwrap();
        let compact = book.to_json();
        let Json::Array(sheets) = compact.get("sheets").unwrap() else {
            panic!()
        };
        let compact_cell = sheets[0].get("cells").unwrap().get("0,0").unwrap();
        assert!(TypedCell::<String>::from_json(compact_cell).is_err());
        let decoded = book.cell_from_json(compact_cell).unwrap();
        assert!(Arc::ptr_eq(decoded.style.as_ref().unwrap(), &style));
        let inline = decoded.to_json();
        assert!(TypedCell::<String>::from_json(&inline).unwrap().style == Some(style));
        book.replace_cells(vec![(0, 0, 0, None), (0, 1, 0, None)], 1_000_000)
            .unwrap();
        assert_eq!(
            book.to_json().get("options").unwrap().get("styles"),
            compact.get("options").unwrap().get("styles")
        );
        book.replace_cells(
            vec![(0, 0, 0, Some(book.cell_from_json(compact_cell).unwrap()))],
            1_000_000,
        )
        .unwrap();
        assert_eq!(book.display(0, 0, 0, 100_000).unwrap(), "3");
    }

    #[test]
    fn excel_syntax_keeps_one_expression_and_preserves_legacy_dialects() {
        let mut book = Spreadsheet::new();
        book.edit(&[(0, 0, 0, "=SUM(1,2)")], 1_000_000).unwrap();
        let cell = book.cell(0, 0, 0).unwrap().into_owned();
        let compact = cell.to_json();
        let node = &items(&compact).unwrap()[0];
        assert_eq!(node.get("syntax"), Some(&string("excel")));
        assert!(node.get("openformula").is_none());
        let decoded = TypedCell::from_json(&compact).unwrap();
        assert_eq!(decoded.formula, cell.formula);
        assert_eq!(decoded.openformula, cell.openformula);
        for original in [None, Some("of:=SUM(1;2)"), Some("msoxl:=1+2")] {
            let mut cell = cell.clone();
            cell.openformula = original.map(str::to_owned);
            let saved = cell.to_json();
            assert!(items(&saved).unwrap()[0].get("syntax").is_none());
            assert_eq!(
                TypedCell::from_json(&saved).unwrap().openformula,
                cell.openformula
            );
        }
        for node in [
            object([("syntax", string("unknown")), ("formula", string("1"))]),
            object([("syntax", string("excel"))]),
            object([
                ("syntax", string("excel")),
                ("formula", string("1")),
                ("openformula", string("of:=2")),
            ]),
        ] {
            assert!(TypedCell::<String>::from_json(&Json::Array(vec![node])).is_err());
        }
        let restored = Spreadsheet::from_json(&book.to_json(), 1_000_000).unwrap();
        assert_eq!(restored.display(0, 0, 0, 1_000_000).unwrap(), "3");
        assert_eq!(restored.to_json(), book.to_json());
    }

    #[test]
    fn style_references_reject_missing_invalid_and_recursive_definitions() {
        let mut book = Spreadsheet::new();
        let batch = Json::Array(vec![object([("style", string("missing"))])]);
        assert!(book.cell_from_json(&batch).is_err());
        book.sheets[0].cells.insert(
            (0, 0),
            TypedCell::from_json(&Json::Array(vec![object([(
                "value",
                Value::<String>::Number(3.).json(),
            )])]))
            .unwrap(),
        );
        let mut document = book.to_json();
        let Json::Object(root) = &mut document else {
            panic!()
        };
        let Json::Array(sheets) = &mut root
            .iter_mut()
            .find(|(k, _)| *k == "sheets".encode_utf16().collect::<Vec<_>>())
            .unwrap()
            .1
        else {
            panic!()
        };
        let Json::Object(sheet) = &mut sheets[0] else {
            panic!()
        };
        let cells = &mut sheet
            .iter_mut()
            .find(|(k, _)| *k == "cells".encode_utf16().collect::<Vec<_>>())
            .unwrap()
            .1;
        *cells = object([("0,0", batch)]);
        assert!(Spreadsheet::from_json(&document, 1_000_000).is_err());
        for invalid in [
            string("missing"),
            Json::Number(0.),
            Json::Array(vec![]),
            object([("family", Json::Bool(true))]),
        ] {
            let mut invalid_document = document.clone();
            let Json::Object(root) = &mut invalid_document else {
                panic!()
            };
            let Json::Object(options) = &mut root
                .iter_mut()
                .find(|(k, _)| *k == "options".encode_utf16().collect::<Vec<_>>())
                .unwrap()
                .1
            else {
                panic!()
            };
            options.push((
                "styles".encode_utf16().collect(),
                object([("missing", invalid)]),
            ));
            assert!(Spreadsheet::from_json(&invalid_document, 1_000_000).is_err());
        }
    }
}
