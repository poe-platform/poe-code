// Shared XLSX cell serialization with exporter-specific workbook defaults.
use super::ssconvert::gnumeric_read::{
    attr as gnm_attr, children as gnm_children, number as gnm_number, source_axis, source_sheet,
};
use super::{WorkbookSheet, xlsx_idx_to_col_ref, xml_escape_text};
use crate::commands::{archive::TarEntry, codecs::encode_zip_members};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write,
    sync::Arc,
};
#[path = "xlsx_gnumeric.rs"]
pub(super) mod gnumeric;
#[path = "xlsx_styles.rs"]
mod styles;
pub(in crate::commands) use styles::Style;
#[path = "xlsx_comments.rs"]
mod comments;
pub(in crate::commands) use comments::Comment;
#[path = "xlsx_rich_text.rs"]
mod rich_text;
pub(in crate::commands) use rich_text::TextRun;
#[path = "xlsx_tables.rs"]
mod tables;

pub(in crate::commands) fn error(value: &str) -> &str {
    match value {
        "Err:502" | "Err:504" | "Err:508" | "Err:509" | "Err:510" | "Err:511" | "Err:522" => {
            "#VALUE!"
        }
        "Err:501" | "Err:512" | "Err:513" | "Err:514" | "Err:518" | "Err:520" | "Err:523"
        | "Err:533" | "Err:538" | "Err:539" => "#N/A",
        value => value,
    }
}

pub(super) enum Cell<'a> {
    Text(&'a str),
    Number(f64),
    Bool(bool),
    Formula(&'a str),
}
pub(super) fn value(s: &str, delimited: bool) -> Cell<'_> {
    if delimited {
        if let Some(f) = s.strip_prefix('=')
            && !f.is_empty()
        {
            return Cell::Formula(f);
        }
        let trimmed = s.trim();
        if trimmed.eq_ignore_ascii_case("true") {
            return Cell::Bool(true);
        }
        if trimmed.eq_ignore_ascii_case("false") {
            return Cell::Bool(false);
        }
        if let Ok(n) = trimmed.parse::<f64>()
            && n.is_finite()
        {
            return Cell::Number(n);
        }
    }
    Cell::Text(s)
}
fn escaped(s: &str) -> String {
    let mut out = String::new();
    for (i, c) in s.char_indices() {
        if c == '\r' {
            out.push('\r');
        } else if (c as u32) < 32 && !matches!(c, '\t' | '\n') {
            write!(out, "_x{:04X}_", c as u32).unwrap();
        } else if c == '_'
            && s.as_bytes().get(i + 1..i + 7).is_some_and(|v| {
                v[0] == b'x' && v[1..5].iter().all(u8::is_ascii_hexdigit) && v[5] == b'_'
            })
        {
            out.push_str("_x005F_");
        } else {
            out.push(c);
        }
    }
    xml_escape_text(&out)
        .replace("&apos;", "'")
        .replace('\r', "&#13;")
}
fn text(s: &str) -> String {
    if s.is_empty() {
        return "<t/>".into();
    }
    format!(
        "<t{}>{}</t>",
        if s.starts_with(|c: char| c.is_whitespace() || c == '\u{feff}')
            || s.ends_with(|c: char| c.is_whitespace() || c == '\u{feff}')
        {
            r#" xml:space="preserve""#
        } else {
            ""
        },
        escaped(s)
    )
}
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
const SS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
#[derive(Clone)]
pub(in crate::commands) enum Value<S> {
    Empty,
    Text(S),
    Number(f64),
    Bool(bool),
    Error(S),
}
#[derive(Clone)]
pub(in crate::commands) struct TypedCell<S> {
    pub value: Option<Value<S>>,
    pub formula: Option<S>,
    pub openformula: Option<S>,
    // Retain imported spelling independently of the expression used to calculate.
    pub formula_display: Option<S>,
    pub format: Option<S>,
    pub value_format: Option<S>,
    pub style: Option<Arc<Style>>,
    pub rich_text: Option<Arc<Vec<TextRun>>>,
}
impl<S: AsRef<str>> TypedCell<S> {
    fn style_key<'a>(
        &'a self,
        default: (&'a str, Option<&'a Style>),
    ) -> (&'a str, Option<&'a Style>) {
        if self.format.is_some() || self.style.is_some() {
            (self.format().unwrap_or("General"), self.style.as_deref())
        } else if default.0 == "General" {
            (self.format().unwrap_or("General"), default.1)
        } else {
            default
        }
    }

    fn format(&self) -> Option<&str> {
        let declared = self.format.as_ref().map(AsRef::as_ref);
        if declared.is_some_and(|f| f != "General") {
            declared
        } else {
            // Calc exports its inferred logical format as General; the cache
            // type carries the Boolean distinction for zero and one.
            self.value_format
                .as_ref()
                .map(AsRef::as_ref)
                .filter(|f| *f != "BOOLEAN" && !f.starts_with("@["))
                .or(declared)
        }
    }
}
#[derive(Clone, Default, PartialEq)]
pub(in crate::commands) struct Axis {
    pub size: Option<f64>,
    pub hidden: bool,
    pub level: usize,
    pub style: Option<Arc<Style>>,
}
#[derive(Clone)]
pub(in crate::commands) enum Scale {
    Percentage(f64),
    Fit(f64, f64),
}
#[derive(Clone, Default)]
pub(in crate::commands) struct Print {
    pub orientation: Option<&'static str>,
    pub margins: Option<[Option<f64>; 4]>,
    pub scale: Option<Scale>,
}
#[derive(Clone)]
pub(in crate::commands) struct Filter {
    pub area: [usize; 4],
    pub fields: Option<BTreeMap<usize, FilterField>>,
    pub show_buttons: bool,
}
#[derive(Clone)]
pub(in crate::commands) struct FilterField {
    pub conditions: Vec<(&'static str, String)>,
    pub conjunction: bool,
}
pub(in crate::commands) struct Table {
    pub name: String,
    pub sheet: usize,
    pub area: [usize; 4],
    pub header: bool,
    pub filter: Option<Filter>,
}
pub(in crate::commands) struct Iteration {
    pub enabled: bool,
    pub maximum: u64,
    pub tolerance: f64,
}
#[derive(Clone)]
pub(in crate::commands) struct CompiledName {
    pub expression: String,
    pub bindings: BTreeMap<String, Option<usize>>,
}
#[derive(Clone)]
pub(in crate::commands) struct NamedExpression {
    pub name: String,
    pub sheet: Option<usize>,
    pub expression: String,
    pub openformula: Option<String>,
    pub position: (usize, i64, i64),
    pub compiled: Option<CompiledName>,
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(in crate::commands) enum LookupSearch {
    Literal,
    #[default]
    Wildcard,
    Regex,
}
#[derive(Default)]
pub(in crate::commands) enum StringRefSyntax {
    CalcA1,
    ExcelA1,
    ExcelR1C1,
    #[default]
    CalcExcelA1,
}
pub(in crate::commands) struct SharedFormula {
    pub sheet: usize,
    pub range: [usize; 4],
    pub origin: (usize, usize),
    pub expression: String,
    pub members: BTreeSet<(usize, usize)>,
}
pub(in crate::commands) struct LabelRange {
    pub column: bool,
    pub labels: [usize; 4],
    pub data: [usize; 4],
    pub data_sheet: usize,
}
#[derive(Default)]
pub(in crate::commands) struct Workbook {
    pub document_properties: BTreeMap<String, super::JVal>,
    pub gnumeric: Option<super::xml::Element>,
    pub odf: Option<crate::commands::archive::office_ods::Source>,
    pub automatic_label_lookup: bool,
    pub label_ranges: Vec<Vec<LabelRange>>,
    pub xlsx_2006: bool,
    pub sheet_sizes: Vec<(usize, usize)>,
    pub case_insensitive: bool,
    pub date1904: bool,
    pub active_sheet: usize,
    pub recalculate: bool,
    pub calculation_cells: Option<BTreeSet<(usize, usize, usize)>>,
    pub manual: bool,
    pub shared_formulas: Vec<SharedFormula>,
    pub lookup_search: LookupSearch,
    pub lookup_substring: bool,
    pub string_ref_syntax: StringRefSyntax,
    pub iteration: Option<Iteration>,
    pub names: Vec<NamedExpression>,
    pub tables: Vec<Table>,
    pub external_links: Vec<(String, Vec<String>)>,
    pub formula_origins: BTreeMap<(usize, usize, usize), (usize, usize, usize)>,
    pub array_string_cells: BTreeSet<(usize, usize, usize)>,
    pub array_string_names: BTreeSet<usize>,
    // Microsoft ODS cell arrays bypass Calc's shared-string pool.
    pub uninterned_arrays: BTreeSet<(usize, usize, usize)>,
    // ODS cell-style assignments suppress automatic formula formatting.
    pub explicit_formula_styles: BTreeSet<(usize, usize, usize)>,
}
#[derive(Clone)]
pub(in crate::commands) struct Sheet<S> {
    pub name: S,
    pub view: Vec<(&'static str, bool)>,
    pub sylk_r1c1: Option<bool>,
    pub sylk_hide_zero: bool,
    pub print: Print,
    pub filter: Option<Filter>,
    pub cells: BTreeMap<(usize, usize), TypedCell<S>>,
    pub rows: BTreeMap<usize, Axis>,
    pub columns: BTreeMap<usize, Axis>,
    pub merges: Vec<[usize; 4]>,
    pub arrays: Vec<ArrayFormula<S>>,
    pub comments: Vec<Comment>,
    pub style_regions: Vec<([usize; 4], Arc<Style>)>,
    pub empty_headers: bool,
}
#[derive(Clone)]
pub(in crate::commands) struct ArrayFormula<S> {
    pub range: [usize; 4],
    pub expression: S,
    pub openformula: Option<S>,
    pub formula_display: Option<S>,
}
pub(super) fn typed_sheets(sheets: &[WorkbookSheet]) -> Option<Vec<Sheet<String>>> {
    let cached: Vec<_> = sheets.iter().map(WorkbookSheet::cached_formulas).collect();
    let mut typed = Vec::new();
    for (sheet_index, sh) in sheets.iter().enumerate() {
        if let Some(sheet) = &sh.typed {
            typed.push(sheet.clone());
            continue;
        }
        let mut cells = BTreeMap::new();
        for (i, row) in sh.rows.iter().enumerate() {
            for (j, raw) in row.iter().enumerate() {
                if raw.is_empty() {
                    continue;
                }
                let mut formula = None;
                let v = match value(raw, sh.delimited) {
                    Cell::Text(s) => Some(Value::Text(s.to_owned())),
                    Cell::Number(n) => Some(Value::Number(n)),
                    Cell::Bool(b) => Some(Value::Bool(b)),
                    Cell::Formula(f) => {
                        formula = Some(f.to_owned());
                        let v = &cached[sheet_index].as_ref()?.rows[i][j];
                        if v == raw {
                            None
                        } else if let Ok(n) = v.parse::<f64>() {
                            Some(Value::Number(n))
                        } else {
                            Some(Value::Text(v.clone()))
                        }
                    }
                };
                cells.insert(
                    (i, j),
                    TypedCell {
                        value: v,
                        formula,
                        openformula: None,
                        formula_display: None,
                        format: None,
                        value_format: None,
                        style: None,
                        rich_text: None,
                    },
                );
            }
        }
        typed.push(Sheet {
            style_regions: vec![],
            name: sh.name.clone(),
            view: Vec::new(),
            sylk_r1c1: None,
            sylk_hide_zero: false,
            print: Print::default(),
            filter: None,
            cells,
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            merges: Vec::new(),
            arrays: Vec::new(),
            comments: Vec::new(),
            empty_headers: true,
        });
    }
    Some(typed)
}

#[derive(Clone, Copy, PartialEq)]
pub(in crate::commands) enum Dialect {
    Gnumeric,
    LibreOffice,
}
pub(in crate::commands) fn write_cells<S: AsRef<str>>(
    dialect: Dialect,
    sheets: &[Sheet<S>],
    workbook: &Workbook,
    limit: usize,
) -> Option<Vec<u8>> {
    let mut differentials = Vec::new();
    let mut counts = BTreeMap::new();
    let mut formats = vec![("General", None)];
    let mut format_ids = BTreeMap::from([(("General", None), 0)]);
    let mut column_defaults = Vec::new();
    for (index, sh) in sheets.iter().enumerate() {
        let size = workbook
            .sheet_sizes
            .get(index)
            .copied()
            .unwrap_or((65536, 256));
        let mut default = 0;
        for (range, style) in &sh.style_regions {
            if *range == [0, 0, size.0 - 1, size.1 - 1] {
                let format = style
                    .attributes
                    .iter()
                    .find(|(k, _)| *k == "Format")
                    .map_or("General", |(_, v)| v.as_str());
                let key = (format, Some(style.as_ref()));
                default = *format_ids.entry(styles::key(key)).or_insert_with(|| {
                    let id = formats.len();
                    formats.push(key);
                    id
                });
            }
        }
        column_defaults.push(default);
        for cell in sh.cells.values() {
            if cell.formula.is_none() {
                if let Some(Value::Text(s)) = &cell.value {
                    *counts
                        .entry((s.as_ref(), cell.rich_text.as_deref()))
                        .or_insert(0usize) += 1;
                }
            }
            {
                let key = cell.style_key(formats[default]);
                format_ids.entry(styles::key(key)).or_insert_with(|| {
                    let id = formats.len();
                    formats.push(key);
                    id
                });
            }
        }
        for axis in sh.columns.values() {
            if let Some(style) = axis.style.as_deref() {
                let key = ("General", Some(style));
                format_ids.entry(styles::key(key)).or_insert_with(|| {
                    let id = formats.len();
                    formats.push(key);
                    id
                });
            }
        }
    }
    let mut ids = BTreeMap::new();
    let mut strings = String::new();
    let mut references = 0;
    let mut entries = vec![];
    let mut remaining = limit;
    let mut add = |name: String, content: Vec<u8>| {
        remaining = remaining.checked_sub(content.len() + name.len() + 64)?;
        entries.push(TarEntry {
            name,
            typeflag: b'0',
            mode: 0o644,
            mtime: 946684800.,
            atime: None,
            uid: 0,
            gid: 0,
            linkname: String::new(),
            content,
        });
        Some(())
    };
    let mut sheet_types = Vec::new();
    let mut comment_types = Vec::new();
    let mut table_types = Vec::new();
    for (index, table) in workbook.tables.iter().enumerate() {
        let n = index + 1;
        add(
            format!("xl/tables/table{n}.xml"),
            tables::write(table, sheets.get(table.sheet)?, n, limit)?.into_bytes(),
        )?;
        table_types.push(format!(r#"<Override PartName="/xl/tables/table{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>"#));
    }
    let mut rels = vec![];
    let mut nodes = String::new();
    let mut names = String::new();
    for (name_index, name) in workbook.names.iter().enumerate() {
        write!(
            names,
            r#"<definedName name="{}{}""#,
            if dialect == Dialect::Gnumeric
                && matches!(name.name.as_str(), "Print_Area" | "Sheet_Title")
            {
                "_xlnm."
            } else {
                ""
            },
            xml_escape_text(&name.name).replace("&apos;", "'")
        )
        .ok()?;
        if let Some(index) = name.sheet {
            write!(names, r#" localSheetId="{index}""#).ok()?;
        }
        let array_strings = workbook.array_string_names.contains(&name_index);
        if array_strings && name.openformula.is_none() {
            names.push_str(r#" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc""#);
        }
        if array_strings {
            names.push_str(r#" ssc:array-string-literals="1""#);
        }
        if let Some(source) = &name.openformula {
            let (sheet, row, column) = name.position;
            let origin = super::JVal::Str(sheets.get(sheet)?.name.as_ref().into())
                .to_json_string(true, false, 0);
            let origin = format!("[{origin},{row},{column}]");
            write!(
                names,
                r#" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" ssc:openformula="{}" ssc:openformula-origin="{}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc""#,
                xml_escape_text(source)
                    .replace("&apos;", "'")
                    .replace('\t', "&#9;")
                    .replace('\n', "&#10;")
                    .replace('\r', "&#13;"),
                xml_escape_text(&origin).replace("&apos;", "'")
            )
            .ok()?;
        }
        write!(names, ">{}</definedName>", escaped(&name.expression)).ok()?;
        if names.len() > limit {
            return None;
        }
    }
    for (idx, sh) in sheets.iter().enumerate() {
        let gnumeric = source_sheet(workbook.gnumeric.as_ref(), sh.name.as_ref());
        let default_size = |kind, fallback| {
            gnumeric
                .into_iter()
                .flat_map(|n| gnm_children(n, kind))
                .filter_map(|n| {
                    gnm_attr(n, "DefaultSizePts").map(|_| gnm_number(n, "DefaultSizePts", fallback))
                })
                .filter(|n| *n > 0.)
                .last()
                .unwrap_or(fallback)
        };
        let default_column = default_size("Cols", 48.);
        let default_row = default_size("Rows", 12.75);
        let column_default = column_defaults[idx];
        let first_row = sh.cells.keys().map(|p| p.0).min().unwrap_or(0);
        let first_col = sh.cells.keys().map(|p| p.1).min().unwrap_or(0);
        let end_row = sh
            .cells
            .keys()
            .map(|p| p.0)
            .chain(sh.rows.keys().copied())
            .chain(sh.merges.iter().map(|r| r[0] + r[3] - 1))
            .max()
            .unwrap_or(0);
        let end_col = sh
            .cells
            .keys()
            .map(|p| p.1)
            .chain(sh.columns.keys().copied())
            .chain(sh.merges.iter().map(|r| r[1] + r[2] - 1))
            .max()
            .unwrap_or(0);
        let mut dimension = format!("{}{}", xlsx_idx_to_col_ref(first_col), first_row + 1);
        if (first_row, first_col) != (end_row, end_col) {
            write!(
                dimension,
                ":{}{}",
                xlsx_idx_to_col_ref(end_col),
                end_row + 1
            )
            .ok()?;
        }
        let mut rows = String::new();
        let mut cells = sh.cells.iter().peekable();
        let mut axes = sh.rows.iter().peekable();
        while cells.peek().is_some() || axes.peek().is_some() {
            let i = cells
                .peek()
                .map_or(usize::MAX, |(p, _)| p.0)
                .min(axes.peek().map_or(usize::MAX, |(i, _)| **i));
            let axis = if axes.peek().is_some_and(|(row, _)| **row == i) {
                axes.next().map(|(_, axis)| axis)
            } else {
                None
            };
            write!(
                rows,
                r#"<row r="{}" spans="{}:{}""#,
                i + 1,
                first_col + 1,
                end_col + 1
            )
            .ok()?;
            if let Some(axis) = axis {
                let original = gnumeric.and_then(|n| source_axis(n, "RowInfo", i));
                let collapsed = original.is_some_and(|n| gnm_number(n, "Collapsed", 0.) != 0.);
                if let Some(size) = axis.size {
                    if original.is_none_or(|n| gnm_number(n, "HardSize", 0.) != 0.) {
                        rows.push_str(r#" customHeight="1""#);
                    }
                    write!(rows, r#" ht="{}""#, attribute_number(size)).ok()?;
                }
                if collapsed {
                    rows.push_str(r#" collapsed="1""#);
                }
                if axis.hidden {
                    rows.push_str(r#" hidden="1""#);
                }
                if axis.level > 0 || collapsed {
                    write!(rows, r#" outlineLevel="{}""#, axis.level).ok()?;
                }
            }
            let has_cells = cells.peek().is_some_and(|(p, _)| p.0 == i);
            rows.push_str(if has_cells { ">" } else { "/>" });
            while cells.peek().is_some_and(|(p, _)| p.0 == i) {
                let (&(_, j), cell) = cells.next()?;
                write!(rows, r#"<c r="{}{}""#, xlsx_idx_to_col_ref(j), i + 1).ok()?;
                let style =
                    *format_ids.get(&styles::key(cell.style_key(formats[column_default])))?;
                if style != column_default {
                    write!(rows, r#" s="{style}""#).ok()?;
                }
                let array = sh.arrays.iter().find(|g| {
                    let [r, c, w, h] = g.range;
                    (r..r + h).contains(&i) && (c..c + w).contains(&j)
                });
                let formula = cell.formula.as_ref().filter(|_| {
                    dialect != Dialect::Gnumeric
                        || array.is_none_or(|g| g.range[0] == i && g.range[1] == j)
                });
                if cell.value.is_none() && formula.is_none() {
                    rows.push_str("/>");
                    if rows.len().saturating_add(strings.len()) > limit {
                        return None;
                    }
                    continue;
                }
                let is_formula = cell.formula.is_some() || array.is_some();
                let value = match &cell.value {
                    Some(Value::Text(s))
                        if !is_formula
                            && counts
                                .get(&(s.as_ref(), cell.rich_text.as_deref()))
                                .copied()
                                .unwrap_or(0)
                                > 1 =>
                    {
                        references += 1;
                        let next = ids.len();
                        let key = (s.as_ref(), cell.rich_text.as_deref());
                        if !ids.contains_key(&key) {
                            let content = match &cell.rich_text {
                                Some(runs) => rich_text::write(runs, false, limit)?,
                                None => text(s.as_ref()),
                            };
                            write!(strings, "<si>{content}</si>").ok()?;
                            ids.insert(key, next);
                        }
                        let id = ids.get(&key)?;
                        write!(rows, r#" t="s"><v>{id}</v>"#).ok()?;
                        None
                    }
                    Some(Value::Text(s)) if !is_formula => {
                        let content = match &cell.rich_text {
                            Some(runs) => rich_text::write(runs, false, limit)?,
                            None => text(s.as_ref()),
                        };
                        write!(rows, r#" t="inlineStr"><is>{content}</is>"#).ok()?;
                        None
                    }
                    value => {
                        match value {
                            Some(Value::Text(_)) => rows.push_str(r#" t="str""#),
                            Some(Value::Bool(_)) => rows.push_str(r#" t="b""#),
                            Some(Value::Number(0. | 1.))
                                if is_formula
                                    && cell
                                        .value_format
                                        .as_ref()
                                        .is_some_and(|f| f.as_ref() == "BOOLEAN") =>
                            {
                                rows.push_str(r#" t="b""#)
                            }
                            Some(Value::Error(_)) => rows.push_str(r#" t="e""#),
                            _ => {}
                        }
                        rows.push('>');
                        if let Some(f) = formula {
                            let array = array.filter(|g| g.range[0] == i && g.range[1] == j);
                            rows.push_str("<f");
                            if let Some(g) = array {
                                let [r, c, w, h] = g.range;
                                let first = format!("{}{}", xlsx_idx_to_col_ref(c), r + 1);
                                let last = format!("{}{}", xlsx_idx_to_col_ref(c + w - 1), r + h);
                                write!(
                                    rows,
                                    r#" t="array" ref="{}""#,
                                    if first == last {
                                        first
                                    } else {
                                        format!("{first}:{last}")
                                    }
                                )
                                .ok()?;
                            }
                            let array_strings = workbook.array_string_cells.contains(&(idx, i, j));
                            if array_strings && cell.openformula.is_none() {
                                rows.push_str(r#" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc""#);
                            }
                            if array_strings {
                                rows.push_str(r#" ssc:array-string-literals="1""#);
                            }
                            if let Some(openformula) = &cell.openformula {
                                write!(
                                    rows,
                                    r#" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" ssc:openformula="{}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc""#,
                                    escaped(openformula.as_ref())
                                        .replace('\t', "&#9;")
                                        .replace('\n', "&#10;")
                                )
                                .ok()?;
                            }
                            write!(rows, ">{}</f>", escaped(f.as_ref())).ok()?;
                        }
                        value.as_ref()
                    }
                };
                if let Some(value) = value {
                    let v = match value {
                        Value::Empty => "0".into(),
                        Value::Text(s) => escaped(s.as_ref()),
                        Value::Error(s) => escaped(error(s.as_ref())),
                        Value::Bool(b) => u8::from(*b).to_string(),
                        Value::Number(n)
                            if dialect == Dialect::LibreOffice && is_formula && *n == 0. =>
                        {
                            n.to_string()
                        }
                        Value::Number(n) if dialect == Dialect::LibreOffice => {
                            crate::commands::archive::office_number(*n)
                        }
                        Value::Number(n) => number(*n),
                    };
                    if v.is_empty() {
                        rows.push_str("<v/>");
                    } else {
                        write!(rows, "<v>{v}</v>").ok()?;
                    }
                }
                rows.push_str("</c>");
                if rows.len().saturating_add(strings.len()) > limit {
                    return None;
                }
            }
            if has_cells {
                rows.push_str("</row>");
            }
            if rows.len().saturating_add(strings.len()) > limit {
                return None;
            }
        }
        let rows = if rows.is_empty() {
            "<sheetData/>".into()
        } else {
            format!("<sheetData>{rows}</sheetData>")
        };
        let column_count = workbook.sheet_sizes.get(idx).map_or_else(
            || (end_col + 1).max(256).next_power_of_two(),
            |&(_, columns)| columns,
        );
        let selected = if idx == workbook.active_sheet {
            r#" tabSelected="1""#
        } else {
            ""
        };
        let mut view = String::new();
        for (name, enabled) in &sh.view {
            write!(view, r#" {name}="{}""#, u8::from(*enabled)).ok()?;
        }
        let mut outline = String::new();
        for (name, axes) in [("Row", &sh.rows), ("Col", &sh.columns)] {
            if let Some(level) = axes.values().map(|a| a.level).max().filter(|n| *n > 0) {
                write!(outline, r#" outlineLevel{name}="{level}""#).ok()?;
            }
        }
        let mut columns = String::new();
        let default = Axis::default();
        let mut start = 0;
        let mut first = 0;
        let mut previous = String::new();
        while start < column_count {
            let axis = sh.columns.get(&start).unwrap_or(&default);
            let mut end = start + 1;
            while end < column_count && sh.columns.get(&end).unwrap_or(&default) == axis {
                end += 1;
            }
            let style = if axis.style.is_some() {
                *format_ids.get(&styles::key(("General", axis.style.as_deref())))?
            } else {
                column_default
            };
            let mut attributes = String::new();
            write!(
                attributes,
                r#" style="{style}" width="{}""#,
                attribute_number(
                    axis.size.unwrap_or(default_column) / ((130. / 18.5703125) * (72. / 96.))
                )
            )
            .ok()?;
            let original = gnumeric.and_then(|n| source_axis(n, "ColInfo", start));
            if axis.size.is_some() && original.is_none_or(|n| gnm_number(n, "HardSize", 0.) != 0.) {
                attributes.push_str(r#" customWidth="1""#);
            }
            if axis.hidden {
                attributes.push_str(r#" hidden="1""#);
            }
            if axis.level > 0 {
                write!(attributes, r#" outlineLevel="{}""#, axis.level).ok()?;
            }
            if original.is_some_and(|n| gnm_number(n, "Collapsed", 0.) != 0.) {
                attributes.push_str(r#" collapsed="1""#);
            }
            if attributes != previous || dialect != Dialect::Gnumeric {
                if !previous.is_empty() {
                    write!(
                        columns,
                        r#"<col min="{}" max="{start}"{previous}/>"#,
                        first + 1
                    )
                    .ok()?;
                }
                first = start;
                previous = attributes;
            }
            if columns.len() > limit {
                return None;
            }
            start = end;
        }
        if !previous.is_empty() {
            write!(
                columns,
                r#"<col min="{}" max="{column_count}"{previous}/>"#,
                first + 1
            )
            .ok()?;
        }
        let mut merges = String::new();
        if !sh.merges.is_empty() {
            merges.push_str("<mergeCells>");
            for &[r, c, w, h] in &sh.merges {
                write!(
                    merges,
                    r#"<mergeCell ref="{}{}:{}{}"/>"#,
                    xlsx_idx_to_col_ref(c),
                    r + 1,
                    xlsx_idx_to_col_ref(c + w - 1),
                    r + h
                )
                .ok()?;
            }
            merges.push_str("</mergeCells>");
        }
        let filter = if let Some(source) = gnumeric {
            self::gnumeric::filter(source, sh.name.as_ref())?.0
        } else if let Some(source) = &sh.filter {
            tables::filter(source, limit, dialect)?
        } else {
            String::new()
        };
        let rules = if let Some(source) = gnumeric {
            self::gnumeric::rules(
                source,
                sh.name.as_ref(),
                &sheets
                    .iter()
                    .map(|s| s.name.as_ref().to_owned())
                    .collect::<Vec<_>>(),
                limit,
                &mut String::new(),
                &mut differentials,
            )
            .ok()?
        } else {
            String::new()
        };
        let (fit, print) = self::gnumeric::print(gnumeric, &sh.print, sh.empty_headers).ok()?;
        let mut table_parts = String::new();
        let mut sheet_rels = String::new();
        for (index, _) in workbook
            .tables
            .iter()
            .enumerate()
            .filter(|(_, table)| table.sheet == idx)
        {
            let id = index + 1;
            let rel = index + 3;
            write!(table_parts, r#"<tablePart r:id="rId{rel}"/>"#).ok()?;
            write!(sheet_rels, r#"<Relationship Id="rId{rel}" Type="{REL}/table" Target="../tables/table{id}.xml"/>"#).ok()?;
        }
        if !table_parts.is_empty() {
            let count = workbook
                .tables
                .iter()
                .filter(|table| table.sheet == idx)
                .count();
            table_parts = format!(r#"<tableParts count="{count}">{table_parts}</tableParts>"#);
        }
        let mut hyperlinks = String::new();
        let mut link_id = if sh.comments.is_empty() { 1 } else { 3 };
        for &(row, col) in sh.cells.keys() {
            let Some(link) = gnumeric
                .and_then(|n| super::ssconvert::gnumeric_read::source_style(n, row, col))
                .and_then(|n| gnm_children(n, "HyperLink").next())
            else {
                continue;
            };
            let field = |key| gnm_attr(link, key);
            let Some(target) = field("target").filter(|s| !s.is_empty()) else {
                continue;
            };
            let internal = field("type") == Some("GnmHLinkCurWB");
            let (target, location) = if internal {
                (target, Some(target))
            } else {
                target
                    .split_once('#')
                    .map_or((target, None), |(t, l)| (t, Some(l)))
            };
            write!(
                hyperlinks,
                r#"<hyperlink ref="{}{}""#,
                xlsx_idx_to_col_ref(col),
                row + 1
            )
            .ok()?;
            if !internal {
                write!(hyperlinks, r#" r:id="rId{link_id}""#).ok()?;
                sheet_rels.insert_str(0, &format!(r#"<Relationship Id="rId{link_id}" Type="{REL}/hyperlink" Target="{}" TargetMode="External"/>"#, escaped(target)));
                link_id += 1;
            }
            if let Some(location) = location {
                write!(hyperlinks, r#" location="{}""#, escaped(location)).ok()?;
            }
            if let Some(tip) = field("tip") {
                write!(hyperlinks, r#" tooltip="{}""#, escaped(tip)).ok()?;
            }
            hyperlinks.push_str("/>");
        }
        if !hyperlinks.is_empty() {
            hyperlinks = format!("<hyperlinks>{hyperlinks}</hyperlinks>");
        }
        let zoom = gnumeric
            .and_then(|n| gnm_children(n, "Zoom").next())
            .map(crate::commands::archive::office::xml_text)
            .and_then(|s| self::zoom(crate::commands::js_number(&s, 0.)))
            .map_or_else(String::new, |v| format!(r#" zoomScale="{v}""#));
        let file = format!(
            include_str!("xlsx/worksheet.xml"),
            fit = fit,
            print = print,
            default_column = attribute_number(default_column / ((130. / 18.5703125) * (72. / 96.))),
            default_row = attribute_number(default_row),
            zoom = zoom,
            hyperlinks = hyperlinks,
            protection = if gnumeric.is_some_and(|n| gnm_number(n, "Protected", 0.) != 0.) {
                r#" sheet="1""#
            } else {
                ""
            },
            dimension = dimension,
            rows = rows,
            columns = columns,
            selected = selected,
            view = view,
            outline = outline,
            merges = merges,
            filter = filter,
            rules = rules,
            tables = table_parts,
            drawing = if sh.comments.is_empty() {
                ""
            } else {
                r#"<legacyDrawing r:id="rId2"/>"#
            }
        );
        let n = idx + 1;
        if !sh.comments.is_empty() {
            let (comments, drawing) = comments::write(&sh.comments, limit)?;
            add(format!("xl/comments{n}.xml"), comments.into_bytes())?;
            add(
                format!("xl/drawings/vmlDrawing{n}.vml"),
                drawing.into_bytes(),
            )?;
            write!(sheet_rels, r#"<Relationship Id="rId2" Type="{REL}/vmlDrawing" Target="../drawings/vmlDrawing{n}.vml"/><Relationship Id="rId1" Type="{REL}/comments" Target="../comments{n}.xml"/>"#).ok()?;
            comment_types.push(format!(r#"<Override PartName="/xl/comments{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>"#));
        }
        if !sheet_rels.is_empty() {
            add(format!("xl/worksheets/_rels/sheet{n}.xml.rels"), format!(r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{sheet_rels}</Relationships>
"#).into_bytes())?;
        }
        if dialect == Dialect::LibreOffice
            && let Some(source) = &sh.filter
        {
            let expression = format!(
                "'{}'!{}",
                sh.name.as_ref().replace('\'', "''"),
                tables::area(source.area, true)
            );
            write!(names, r#"<definedName name="_xlnm._FilterDatabase" localSheetId="{idx}" hidden="true">{}</definedName>"#, escaped(&expression)).ok()?;
        }
        let name = if dialect == Dialect::Gnumeric {
            xml_escape_text(sh.name.as_ref())
                .replace("&apos;", "'")
                .replace('\r', "&#13;")
        } else {
            escaped(sh.name.as_ref())
        }
        .replace('\t', "&#9;")
        .replace('\n', "&#10;");
        add(format!("xl/worksheets/sheet{n}.xml"), file.into_bytes())?;
        sheet_types.push(format!(r#"<Override PartName="/xl/worksheets/sheet{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#));
        rels.push(format!(
            r#"<Relationship Id="rId{n}" Type="{REL}/worksheet" Target="worksheets/sheet{n}.xml"/>"#
        ));
        write!(
            nodes,
            r#"<sheet name="{name}" sheetId="{n}" r:id="rId{n}"/>"#
        )
        .ok()?;
        for (name, expression) in [
            (
                "Sheet_Title",
                format!("\"{}\"", sh.name.as_ref().replace('"', "\"\"")),
            ),
            ("Print_Area", "#REF!".into()),
        ] {
            if dialect == Dialect::Gnumeric
                && !workbook
                    .names
                    .iter()
                    .any(|n| n.name == name && n.sheet == Some(idx))
            {
                write!(
                    names,
                    r#"<definedName name="_xlnm.{name}" localSheetId="{idx}">{}</definedName>"#,
                    escaped(&expression)
                )
                .ok()?;
            }
        }
    }
    let mut shared = "";
    if !ids.is_empty() {
        let xml = format!(
            "{XML}<sst xmlns=\"{SS}\" uniqueCount=\"{}\" count=\"{references}\">{strings}</sst>\n",
            ids.len()
        );
        add("xl/sharedStrings.xml".into(), xml.into_bytes())?;
        rels.push(format!(
            r#"<Relationship Id="rId{}" Type="{REL}/sharedStrings" Target="sharedStrings.xml"/>"#,
            rels.len() + 1
        ));
        shared = r#"<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#;
    }
    rels.push(format!(
        r#"<Relationship Id="rId{}" Type="{REL}/styles" Target="styles.xml"/>"#,
        rels.len() + 1
    ));
    add(
        "xl/styles.xml".into(),
        styles::write(
            &formats,
            workbook.xlsx_2006,
            &gnumeric::differentials(&differentials).ok()?,
            limit,
        )?
        .into_bytes(),
    )?;
    let [app, core, custom] =
        crate::commands::archive::office::xlsx_gnumeric::properties::xlsx(workbook);
    for (name, data) in [
        (
            "docProps/app.xml",
            if dialect == Dialect::Gnumeric {
                app.as_bytes()
            } else {
                include_bytes!("xlsx/app-libreoffice.xml").as_slice()
            },
        ),
        ("docProps/core.xml", core.as_bytes()),
        ("docProps/custom.xml", custom.as_bytes()),
    ] {
        add(name.into(), data.to_vec())?;
    }
    let mut external_references = String::new();
    let mut external_types = Vec::new();
    for (index, (target, sheets)) in workbook.external_links.iter().enumerate() {
        let n = index + 1;
        let id = rels.len() + 1;
        rels.push(format!(r#"<Relationship Id="rId{id}" Type="{REL}/externalLink" Target="externalLinks/externalLink{n}.xml"/>"#));
        write!(
            external_references,
            r#"<externalReference r:id="rId{id}"/>"#
        )
        .ok()?;
        let sheet_names = if sheets.is_empty() {
            "<sheetNames/>".into()
        } else {
            format!(
                "<sheetNames>{}</sheetNames>",
                sheets
                    .iter()
                    .map(|sheet| format!(r#"<sheetName val="{}"/>"#, escaped(sheet)))
                    .collect::<String>()
            )
        };
        add(format!("xl/externalLinks/externalLink{n}.xml"), format!("{XML}<externalLink xmlns=\"{SS}\" xmlns:r=\"{REL}\"><externalBook r:id=\"rId1\">{sheet_names}<sheetDataSet/></externalBook></externalLink>\n").into_bytes())?;
        add(format!("xl/externalLinks/_rels/externalLink{n}.xml.rels"), format!("{XML}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"{REL}/externalLinkPath\" Target=\"{}\" TargetMode=\"External\"/></Relationships>\n", xml_escape_text(target).replace("&apos;", "'")).into_bytes())?;
        external_types.push(format!(r#"<Override PartName="/xl/externalLinks/externalLink{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>"#));
    }
    if !external_references.is_empty() {
        external_references =
            format!("<externalReferences>{external_references}</externalReferences>");
    }
    external_types.reverse();
    add(
        "xl/workbook.xml".into(),
        format!(
            include_str!("xlsx/workbook.xml"),
            nodes = nodes,
            external_references = external_references,
            names = names,
            web_encoding = if workbook.xlsx_2006 {
                "codePage=\"1252\""
            } else {
                "characterSet=\"UTF-8\""
            },
            calc_mode = if workbook.manual { "manual" } else { "auto" },
            date1904 = u8::from(workbook.date1904),
            active = workbook.active_sheet,
            iterate = u8::from(
                workbook
                    .iteration
                    .as_ref()
                    .map_or(dialect == Dialect::Gnumeric, |i| i.enabled)
            ),
            iterate_count = workbook.iteration.as_ref().map_or(100, |i| i.maximum),
            iterate_delta =
                attribute_number(workbook.iteration.as_ref().map_or(0.001, |i| i.tolerance)),
        )
        .into_bytes(),
    )?;
    rels.reverse();
    add("xl/_rels/workbook.xml.rels".into(),format!("{XML}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}</Relationships>\n",rels.join("")).into_bytes())?;
    sheet_types.reverse();
    comment_types.reverse();
    add(
        "[Content_Types].xml".into(),
        format!(
            include_str!("xlsx/content-types.xml"),
            shared = shared,
            external_links = external_types.join(""),
            comments = comment_types.join(""),
            tables = table_types.join(""),
            sheets = sheet_types.join("")
        )
        .into_bytes(),
    )?;
    add(
        "_rels/.rels".into(),
        include_bytes!("xlsx/root.rels").to_vec(),
    )?;
    Some(encode_zip_members(
        &entries,
        (8, 6),
        &[],
        true,
        (false, None, false),
        (&Default::default(), &Default::default()),
        |_, _, _, _| true,
    ))
}

pub(in crate::commands) fn zoom(value: f64) -> Option<String> {
    if value == 1. {
        return None;
    }
    let value = value * 100.;
    let floor = value.floor();
    Some(attribute_number(if value - floor >= 0.5 {
        floor + 1.
    } else {
        floor
    }))
}

// XML numeric attributes use JavaScript's shortest decimal representation;
// cell values below use Gnumeric's 17-digit representation.
pub(in crate::commands) fn attribute_number(n: f64) -> String {
    if !n.is_finite() {
        return if n.is_nan() {
            "NaN"
        } else if n.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .into();
    }
    if n == 0. {
        return "0".into();
    }
    if (1e-6..1e21).contains(&n.abs()) {
        return n.to_string();
    }
    let scientific = format!("{n:e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    format!("{mantissa}e{exponent:+}")
}
// Every binary64 fraction terminates by decimal place 1074. Round those exact
// digits once, including halfway values, before applying decimal placeholders.
pub(in crate::commands) fn fixed_number(n: f64, precision: usize, shift: i32) -> String {
    let exact = format!("{:.1074}", n.abs());
    let point = exact.find('.').unwrap() as i32 + shift;
    let mut digits = exact.replace('.', "").into_bytes();
    let keep = point + precision as i32;
    if keep < 0 {
        digits = vec![b'0'];
    } else {
        let keep = keep as usize;
        let up = digits.get(keep).is_some_and(|c| *c >= b'5');
        digits.resize(keep, b'0');
        if up {
            let mut carry = true;
            for digit in digits.iter_mut().rev() {
                if *digit == b'9' {
                    *digit = b'0';
                } else {
                    *digit += 1;
                    carry = false;
                    break;
                }
            }
            if carry {
                digits.insert(0, b'1');
            }
        }
    }
    let first = digits
        .iter()
        .position(|c| *c != b'0')
        .unwrap_or(digits.len());
    digits.drain(..first.min(digits.len().saturating_sub(precision + 1)));
    if digits.len() <= precision {
        digits.splice(..0, std::iter::repeat_n(b'0', precision + 1 - digits.len()));
    }
    if precision != 0 {
        digits.insert(digits.len() - precision, b'.');
    }
    String::from_utf8(digits).unwrap()
}

pub(in crate::commands) fn display_number(n: f64) -> String {
    // Preserve full numeric precision before applying a cell's display format.
    if n == 0. {
        return "0".into();
    }
    let scientific = format!("{n:e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    if !(-4..17).contains(&exponent) {
        format!(
            "{mantissa}E{}{exponent:02}",
            if exponent < 0 { "-" } else { "+" },
            exponent = exponent.abs()
        )
    } else {
        let decimals = mantissa.split_once('.').map_or(0, |(_, s)| s.len());
        let precision = (decimals as i32 - exponent).max(0) as usize;
        format!("{n:.precision$}")
    }
}

pub(in crate::commands) fn number(n: f64) -> String {
    if n == 0. {
        return "0".into();
    }
    let scientific = format!("{n:.16e}");
    let (mantissa, exp) = scientific.split_once('e').unwrap();
    let exp = exp.parse::<i32>().unwrap();
    if !(-4..17).contains(&exp) {
        format!(
            "{}e{}{:02}",
            mantissa.trim_end_matches('0').trim_end_matches('.'),
            if exp < 0 { "-" } else { "+" },
            exp.unsigned_abs()
        )
    } else {
        let result = format!("{n:.precision$}", precision = (16 - exp).max(0) as usize);
        if result.contains('.') {
            result
                .trim_end_matches('0')
                .trim_end_matches('.')
                .to_owned()
        } else {
            result
        }
    }
}

fn builtin_format(format: &str) -> Option<usize> {
    Some(match format {
        "General" => 0,
        "0" => 1,
        "0.00" => 2,
        "#,##0" => 3,
        "#,##0.00" => 4,
        "0%" => 9,
        "0.00%" => 10,
        "0.00E+00" => 11,
        "# ?/?" => 12,
        "# ??/??" => 13,
        "d-mmm-yy" => 15,
        "d-mmm" => 16,
        "mmm-yy" => 17,
        "h:mm AM/PM" => 18,
        "h:mm:ss AM/PM" => 19,
        "h:mm" => 20,
        "h:mm:ss" => 21,
        "m/d/yy h:mm" => 22,
        "#,##0 ;(#,##0)" => 37,
        "#,##0 ;[Red](#,##0)" => 38,
        "#,##0.00;(#,##0.00)" => 39,
        "#,##0.00;[Red](#,##0.00)" => 40,
        "mm:ss" => 45,
        "[h]:mm:ss" => 46,
        "mmss.0" => 47,
        "##0.0E+0" => 48,
        "@" => 49,
        _ => return None,
    })
}
