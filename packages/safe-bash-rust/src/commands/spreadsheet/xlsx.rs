// Shared XLSX cell serialization with exporter-specific workbook defaults.
use super::xml_escape_text;
use crate::commands::structured::{JVal, xlsx_idx_to_col_ref};
use crate::commands::{archive::TarEntry, codecs::encode_zip_members};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write,
    sync::Arc,
};
#[path = "xlsx_styles.rs"]
mod styles;
pub use styles::Style;
#[path = "xlsx_comments.rs"]
mod comments;
pub use comments::Comment;
#[path = "xlsx_rich_text.rs"]
mod rich_text;
pub use rich_text::TextRun;
#[path = "xlsx_pivots.rs"]
mod pivots;
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

pub(super) fn escaped(s: &str) -> String {
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
pub enum Value<S> {
    Empty,
    Text(S),
    Number(f64),
    Bool(bool),
    Error(S),
}
#[derive(Clone)]
pub struct TypedCell<S> {
    // Ordinary imported Excel formulas use scalar implicit intersection.
    pub legacy_formula: bool,
    pub value: Option<Value<S>>,
    pub formula: Option<S>,
    pub openformula: Option<S>,
    // ODS bad tokens keep their displayed spelling independently of calculation.
    pub formula_display: Option<S>,
    pub format: Option<S>,
    pub value_format: Option<S>,
    pub style: Option<Arc<Style>>,
    pub rich_text: Option<Arc<Vec<TextRun>>>,
}
impl<S: AsRef<str>> TypedCell<S> {
    /// Preserve calendar values when moving literal cells between Excel epochs.
    /// Formula caches, times, durations and ordinary numbers are unchanged.
    pub fn convert_date_system(
        &mut self,
        from1904: bool,
        to1904: bool,
        work: &mut usize,
    ) -> Result<(), String> {
        use super::{
            dates,
            number_format::{FormatKind, format_kind},
        };
        if from1904 == to1904 || self.formula.is_some() {
            return Ok(());
        }
        let Some(Value::Number(number)) = self.value else {
            return Ok(());
        };
        let Some(format) = self.format() else {
            return Ok(());
        };
        *work = work
            .checked_sub(format.len().saturating_mul(32).saturating_add(512))
            .ok_or("Date conversion exceeds its limit")?;
        let sections = dates::sections(format, true)?;
        let Some((pattern, _)) = dates::select(&sections, number) else {
            return Ok(());
        };
        let tokens = dates::tokens(pattern, work)?;
        if !matches!(
            format_kind(&tokens, sections[0].currency),
            FormatKind::Date | FormatKind::DateTime
        ) {
            return Ok(());
        }
        // Excel's 1900 calendar includes January 0 and the fictitious February 29.
        // Neither has a corresponding day in the 1904 calendar.
        if !number.is_finite() || !from1904 && matches!(number.floor(), 0. | 60.) {
            return Err("Date cannot be represented in the destination date system".into());
        }
        let converted = if from1904 {
            number + if number < -1401. { 1461. } else { 1462. }
        } else {
            number - if number < 60. { 1461. } else { 1462. }
        };
        if !to1904 && converted.floor() == 0. {
            return Err("Date cannot be represented in the destination date system".into());
        }
        self.value = Some(Value::Number(converted));
        Ok(())
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
                .filter(|f| *f != "BOOLEAN")
                .or(declared)
        }
    }
}
#[derive(Clone, Default, PartialEq)]
pub struct Axis {
    pub size: Option<f64>,
    pub hidden: bool,
    pub level: usize,
    pub style: Option<Arc<Style>>,
}
pub enum Scale {
    Percentage(f64),
    Fit(f64, f64),
}
#[derive(Default)]
pub struct Print {
    pub orientation: Option<&'static str>,
    pub margins: Option<[Option<f64>; 4]>,
    pub scale: Option<Scale>,
}
pub struct Filter {
    pub column_visibility: bool,
    pub area: [usize; 4],
    pub fields: Option<BTreeMap<usize, FilterField>>,
    pub show_buttons: bool,
}
#[derive(Clone)]
pub struct TopFilter {
    pub rank: f64,
    pub percent: bool,
    pub bottom: bool,
}
#[derive(Clone)]
pub struct DynamicFilter {
    pub kind: String,
    /// Cached thresholds from the last filter application, retained in XLSX.
    pub value: Option<f64>,
    pub max_value: Option<f64>,
}
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct ColorFilter {
    pub font: bool,
    /// Resolved ARGB, or None for no fill. Automatic font color is black.
    pub color: Option<String>,
}
#[derive(Clone)]
pub struct FilterField {
    pub color: Option<ColorFilter>,
    pub dynamic: Option<DynamicFilter>,
    /// Calendar prefixes: [year], [year, month], through [year, month, day, hour, minute, second].
    /// Combined with ordinary selected values using OR.
    pub date_groups: Vec<Vec<usize>>,
    pub top: Option<TopFilter>,
    pub hidden_rows: Option<Vec<usize>>,
    pub custom: bool,
    pub conditions: Vec<(&'static str, String)>,
    pub conjunction: bool,
}
#[derive(Clone)]
pub struct CalculatedColumn {
    pub formula: String,
    pub array: bool,
    /// Current position of the surviving authored row used to derive this
    /// first-data-row template. None starts at the first data row.
    pub origin_row: Option<usize>,
}
pub struct TableStyle {
    pub name: Option<String>,
    pub show_first_column: bool,
    pub show_last_column: bool,
    pub show_row_stripes: bool,
    pub show_column_stripes: bool,
}
pub struct Table {
    pub style: Option<TableStyle>,
    pub calculated_columns: BTreeMap<usize, CalculatedColumn>,
    pub columns: Vec<String>,
    pub totals: bool,
    pub name: String,
    pub sheet: usize,
    pub area: [usize; 4],
    pub header: bool,
    pub filter: Option<Filter>,
}
pub struct Iteration {
    pub enabled: bool,
    pub maximum: u64,
    pub tolerance: f64,
}
#[derive(Clone)]
pub struct CompiledName {
    pub expression: String,
    pub bindings: BTreeMap<String, Option<usize>>,
}
#[derive(Clone)]
pub struct NamedExpression {
    pub name: String,
    pub sheet: Option<usize>,
    pub expression: String,
    pub openformula: Option<String>,
    pub position: (usize, i64, i64),
    pub compiled: Option<CompiledName>,
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum LookupSearch {
    Literal,
    #[default]
    Wildcard,
    Regex,
}
#[derive(Default)]
pub enum StringRefSyntax {
    CalcA1,
    ExcelA1,
    ExcelR1C1,
    #[default]
    CalcExcelA1,
}
#[derive(Default)]
pub struct Workbook {
    // Imported style definitions stay stable; cell edits replace their own style.
    pub styles: BTreeMap<String, Arc<Style>>,
    pub default_style: Option<Arc<Style>>,
    pub case_insensitive: bool,
    pub date1904: bool,
    pub recalculate: bool,
    pub lookup_search: LookupSearch,
    pub lookup_substring: bool,
    pub string_ref_syntax: StringRefSyntax,
    pub iteration: Option<Iteration>,
    pub names: Vec<NamedExpression>,
    pub name_dependencies: BTreeMap<usize, Vec<usize>>,
    pub name_uses: Vec<(usize, usize)>,
    pub tables: Vec<Table>,
    pub pivots: BTreeMap<String, super::pivot::PivotTable>,
    pub conditional_formats: Vec<super::conditional::ConditionalFormat>,
    pub formula_origins: BTreeMap<(usize, usize, usize), (usize, usize, usize)>,
    // Microsoft ODS cell arrays bypass Calc's shared-string pool.
    pub uninterned_arrays: BTreeSet<(usize, usize, usize)>,
    // ODS cell-style assignments suppress automatic formula formatting.
    pub explicit_formula_styles: BTreeSet<(usize, usize, usize)>,
}
pub struct Hyperlink {
    pub reference: String,
    pub target: Option<String>,
    pub target_mode: Option<String>,
    pub location: Option<String>,
    pub display: Option<String>,
    pub tooltip: Option<String>,
}
pub struct Sheet<S> {
    pub hyperlinks: Vec<Hyperlink>,
    pub validations: Vec<super::validation::DataValidation>,
    pub name: S,
    pub state: &'static str,
    pub view: Vec<(&'static str, bool)>,
    pub frozen_rows: usize,
    pub frozen_columns: usize,
    pub print: Print,
    pub filter: Option<Filter>,
    pub cells: BTreeMap<(usize, usize), TypedCell<S>>,
    pub rows: BTreeMap<usize, Axis>,
    pub columns: BTreeMap<usize, Axis>,
    pub merges: Vec<[usize; 4]>,
    pub arrays: Vec<ArrayFormula<S>>,
    pub comments: Vec<Comment>,
    pub empty_headers: bool,
    /// Worksheet defaults in points; absent values retain legacy converter defaults.
    pub default_row_height: Option<f64>,
    pub default_column_width: Option<f64>,
}
pub struct ArrayFormula<S> {
    pub range: [usize; 4],
    pub expression: S,
    pub openformula: Option<S>,
    pub formula_display: Option<S>,
}
#[derive(Clone, Copy, PartialEq)]
pub enum Dialect {
    Gnumeric,
    LibreOffice,
}
// A custom number format needs a cell XF in Excel. Include inherited appearance
// in that export record, while leaving the authored sparse model unchanged.
fn cell_format<'a>(
    cell: &'a TypedCell<String>,
    sheet: &'a Sheet<String>,
    workbook: &'a Workbook,
    row: usize,
    column: usize,
) -> (&'a str, Option<&'a Style>) {
    let format = cell.format().unwrap_or("General");
    let style = cell.style.as_deref().or_else(|| {
        if format == "General" {
            return None;
        }
        sheet
            .rows
            .get(&row)
            .and_then(|axis| axis.style.as_deref())
            .or_else(|| {
                sheet
                    .columns
                    .get(&column)
                    .and_then(|axis| axis.style.as_deref())
            })
            .or(workbook.default_style.as_deref())
    });
    (format, style)
}

pub(in crate::commands) fn write_cells(
    dialect: Dialect,
    sheets: &[Sheet<String>],
    workbook: &Workbook,
    limit: usize,
    spills: Option<&super::formulas::SpillCache>,
) -> Option<Vec<u8>> {
    let active = sheets.iter().position(|s| s.state == "visible")?;
    if sheets.iter().any(|s| {
        s.frozen_rows >= 1_048_576
            || s.frozen_columns >= 16_384
            || !matches!(s.state, "visible" | "hidden" | "veryHidden")
    }) {
        return None;
    }
    // Borrow authored cells. Only derived output needs a temporary export cell;
    // the workbook and its strings/styles are otherwise never cloned.
    let mut work = limit;
    let mut filter_colors = BTreeMap::new();
    for filter in sheets
        .iter()
        .filter_map(|sheet| sheet.filter.as_ref())
        .chain(
            workbook
                .tables
                .iter()
                .filter_map(|table| table.filter.as_ref()),
        )
    {
        for field in filter.fields.iter().flat_map(|fields| fields.values()) {
            work = work.checked_sub(128)?;
            if let Some(color) = &field.color {
                let index = workbook.conditional_formats.len() + filter_colors.len();
                filter_colors.entry(color).or_insert(index);
            }
        }
    }
    let mut exported = Vec::new();
    for (sheet, source) in sheets.iter().enumerate() {
        work = work.checked_sub(source.cells.len().checked_mul(64)?)?;
        let mut cells: BTreeMap<_, std::borrow::Cow<'_, TypedCell<String>>> = source
            .cells
            .iter()
            .map(|(&p, cell)| (p, std::borrow::Cow::Borrowed(cell)))
            .collect();
        if let Some(spills) = spills {
            for (&(_, r, c), value) in spills
                .values
                .range((sheet, 0, 0)..=(sheet, usize::MAX, usize::MAX))
            {
                work = work.checked_sub(
                    256 + match value {
                        Value::Text(s) | Value::Error(s) => s.len(),
                        _ => 0,
                    },
                )?;
                let mut cell = source.cells.get(&(r, c)).cloned().unwrap_or(TypedCell {
                    legacy_formula: false,
                    value: None,
                    formula: None,
                    openformula: None,
                    formula_display: None,
                    format: None,
                    value_format: None,
                    style: None,
                    rich_text: None,
                });
                cell.value = Some(value.clone());
                if let Some(style) = spills.styles.get(&(sheet, r, c)) {
                    cell.style = Some(style.clone());
                }
                cells.insert((r, c), std::borrow::Cow::Owned(cell));
            }
        }
        exported.push(cells);
    }
    let formula_sheets: Vec<_> = sheets
        .iter()
        .map(|s| (s.name.clone(), String::new()))
        .collect();
    let mut has_dynamic = false;
    let mut rich_errors = Vec::new();
    let mut counts = BTreeMap::new();
    let mut formats = vec![("General", workbook.default_style.as_deref())];
    let mut format_ids = BTreeMap::from([(("General", None), 0)]);
    format_ids.insert(("General", workbook.default_style.as_deref()), 0);
    for (sh, cells) in sheets.iter().zip(&exported) {
        for (&(row, column), cell) in cells {
            if cell.formula.is_none() {
                if let Some(Value::Text(s)) = &cell.value {
                    *counts
                        .entry((s.as_str(), cell.rich_text.as_deref()))
                        .or_insert(0usize) += 1;
                }
            }
            {
                let key = cell_format(cell, sh, workbook, row, column);
                format_ids.entry(key).or_insert_with(|| {
                    let id = formats.len();
                    formats.push(key);
                    id
                });
            }
        }
        for axis in sh.columns.values().chain(sh.rows.values()) {
            if let Some(style) = axis.style.as_deref() {
                let key = ("General", Some(style));
                format_ids.entry(key).or_insert_with(|| {
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
            tables::write(table, sheets, workbook, &filter_colors, n, limit)?.into_bytes(),
        )?;
        table_types.push(format!(r#"<Override PartName="/xl/tables/table{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>"#));
    }
    for (index, pivot) in workbook.pivots.values().enumerate() {
        let id = index + 1;
        let (definition, cache) = pivots::write(pivot, id, sheets, workbook, spills, &mut work)?;
        add(
            format!("xl/pivotTables/pivotTable{id}.xml"),
            definition.into_bytes(),
        )?;
        add(
            format!("xl/pivotCache/pivotCacheDefinition{id}.xml"),
            cache.into_bytes(),
        )?;
        add(format!("xl/pivotTables/_rels/pivotTable{id}.xml.rels"), format!(r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition{id}.xml"/></Relationships>"#).into_bytes())?;
        for (path, kind) in [
            (format!("pivotTables/pivotTable{id}"), "pivotTable"),
            (
                format!("pivotCache/pivotCacheDefinition{id}"),
                "pivotCacheDefinition",
            ),
        ] {
            table_types.push(format!(r#"<Override PartName="/xl/{path}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.{kind}+xml"/>"#));
        }
    }
    let mut rels = vec![];
    let mut nodes = String::new();
    let mut names = String::new();
    let sheet_names: Vec<_> = sheets.iter().map(|s| s.name.clone()).collect();
    for name in &workbook.names {
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
        if let Some(source) = &name.openformula {
            let (sheet, row, column) = name.position;
            let origin = JVal::Str(sheets.get(sheet)?.name.clone()).to_json_string(true, false, 0);
            let origin = format!("[{origin},{row},{column}]");
            write!(names, r#" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" ssc:openformula="{}" ssc:openformula-origin="{}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc""#,
                escaped(source).replace('\t', "&#9;").replace('\n', "&#10;"),
                xml_escape_text(&origin).replace("&apos;", "'")).ok()?;
        }
        let expression = name
            .openformula
            .as_deref()
            .and_then(|source| source.strip_prefix("msoxl:="))
            .unwrap_or(&name.expression);
        // Editor-created names use the same formula spelling as cell input.
        // Imported names retain their original namespace via openformula.
        let expression = if spills.is_some()
            && name
                .compiled
                .as_ref()
                .is_some_and(|c| !c.expression.starts_with("of:="))
        {
            std::borrow::Cow::Owned(super::formulas::xlsx_bound_name(
                name,
                &sheet_names,
                &workbook.names,
                &workbook.tables,
                &mut work,
            )?)
        } else if spills.is_some() && name.openformula.is_none() {
            super::formula_arguments::rewrite(
                expression.strip_prefix('=').unwrap_or(expression),
                super::formula_arguments::Syntax::Editor,
                &[],
                &mut work,
            )?
        } else {
            std::borrow::Cow::Borrowed(expression)
        };
        let expression = if spills.is_some() {
            super::formulas::xlsx_variables(&expression, &mut work)?
        } else {
            std::borrow::Cow::Borrowed(expression.as_ref())
        };
        write!(names, ">{}</definedName>", escaped(&expression)).ok()?;
        if names.len() > limit {
            return None;
        }
    }
    for (idx, sh) in sheets.iter().enumerate() {
        let filtered = super::editor_filter::rows(sh, workbook, idx, &mut { limit })?;
        let sheet_cells = &exported[idx];
        let first_row = sheet_cells.keys().map(|p| p.0).min().unwrap_or(0);
        let first_col = sheet_cells.keys().map(|p| p.1).min().unwrap_or(0);
        let end_row = sheet_cells
            .keys()
            .map(|p| p.0)
            .chain(sh.rows.keys().copied())
            .chain(filtered.iter().copied())
            .max()
            .unwrap_or(0);
        let end_col = sheet_cells
            .keys()
            .map(|p| p.1)
            .chain(sh.columns.keys().copied())
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
        let mut cells = sheet_cells.iter().peekable();
        let mut axes = sh.rows.iter().peekable();
        let mut filtered = filtered.into_iter().peekable();
        while cells.peek().is_some() || axes.peek().is_some() || filtered.peek().is_some() {
            let i = cells
                .peek()
                .map_or(usize::MAX, |(p, _)| p.0)
                .min(axes.peek().map_or(usize::MAX, |(i, _)| **i))
                .min(filtered.peek().copied().unwrap_or(usize::MAX));
            let is_filtered = filtered.peek().is_some_and(|row| *row == i);
            if is_filtered {
                filtered.next();
            }
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
                if let Some(style) = axis.style.as_deref() {
                    let id = format_ids.get(&("General", Some(style)))?;
                    write!(rows, r#" s="{id}" customFormat="1""#).ok()?;
                }
                if let Some(size) = axis.size {
                    write!(rows, r#" customHeight="1" ht="{}""#, attribute_number(size)).ok()?;
                }

                if axis.level > 0 {
                    write!(rows, r#" outlineLevel="{}""#, axis.level).ok()?;
                }
            }
            if is_filtered && axis.is_some_and(|axis| axis.hidden) {
                rows.push_str(r#" xmlns:ssc="urn:poe-code:spreadsheet:filters:1" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc" ssc:manualHidden="1""#);
            }
            if is_filtered || axis.is_some_and(|axis| axis.hidden) {
                rows.push_str(r#" hidden="1""#);
            }
            let has_cells = cells.peek().is_some_and(|(p, _)| p.0 == i);
            rows.push_str(if has_cells { ">" } else { "/>" });
            while cells.peek().is_some_and(|(p, _)| p.0 == i) {
                let (&(_, j), cell) = cells.next()?;
                write!(rows, r#"<c r="{}{}""#, xlsx_idx_to_col_ref(j), i + 1).ok()?;
                let rich_error = if spills.is_some() {
                    match &cell.value {
                        Some(Value::Error(e)) if e == "#SPILL!" => Some(8u8),
                        Some(Value::Error(e)) if e == "#CALC!" => Some(13u8),
                        _ => None,
                    }
                } else {
                    None
                };
                if let Some(code) = rich_error {
                    let index = rich_errors
                        .iter()
                        .position(|c| *c == code)
                        .unwrap_or_else(|| {
                            rich_errors.push(code);
                            rich_errors.len() - 1
                        });
                    write!(rows, r#" vm="{}""#, index + 1).ok()?;
                }
                let dynamic = spills.and_then(|s| s.ranges.get(&(idx, i, j)));
                if dynamic.is_some()
                    || spills.is_some()
                        && cell.formula.is_some()
                        && !cell.legacy_formula
                        && !sh.arrays.iter().any(|g| g.range[0] == i && g.range[1] == j)
                {
                    rows.push_str(r#" cm="1""#);
                    has_dynamic = true;
                }
                let style = *format_ids.get(&cell_format(cell, sh, workbook, i, j))?;
                if style != 0 || cell.style.is_some() {
                    write!(rows, r#" s="{style}""#).ok()?;
                }
                if cell.value.is_none() && cell.formula.is_none() {
                    rows.push_str("/>");
                    if rows.len().saturating_add(strings.len()) > limit {
                        return None;
                    }
                    continue;
                }
                let is_formula = cell.formula.is_some()
                    || spills.is_some_and(|s| s.values.contains_key(&(idx, i, j)))
                    || sh.arrays.iter().any(|g| {
                        let [r, c, w, h] = g.range;
                        (r..r + h).contains(&i) && (c..c + w).contains(&j)
                    });
                let value = match &cell.value {
                    Some(Value::Text(s))
                        if !is_formula
                            && counts
                                .get(&(s.as_str(), cell.rich_text.as_deref()))
                                .copied()
                                .unwrap_or(0)
                                > 1 =>
                    {
                        references += 1;
                        let next = ids.len();
                        let key = (s.as_str(), cell.rich_text.as_deref());
                        if !ids.contains_key(&key) {
                            let content = match &cell.rich_text {
                                Some(runs) => rich_text::write(runs, limit)?,
                                None => text(s.as_str()),
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
                            Some(runs) => rich_text::write(runs, limit)?,
                            None => text(s.as_str()),
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
                                        .is_some_and(|f| f.as_str() == "BOOLEAN") =>
                            {
                                rows.push_str(r#" t="b""#)
                            }
                            Some(Value::Error(_)) => rows.push_str(r#" t="e""#),
                            _ => {}
                        }
                        rows.push('>');
                        if let Some(f) = &cell.formula {
                            let array = sh
                                .arrays
                                .iter()
                                .find(|g| g.range[0] == i && g.range[1] == j);
                            rows.push_str("<f");
                            let area = dynamic
                                .map(|&[w, h]| [i, j, w, h])
                                .or_else(|| array.map(|g| g.range));
                            if let Some([r, c, w, h]) = area {
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
                            if let Some(openformula) = &cell.openformula {
                                write!(rows,r#" xmlns:ssc="urn:poe-code:ssconvert:formulas:1" ssc:openformula="{}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="ssc""#,escaped(openformula.as_str()).replace('\t', "&#9;").replace('\n', "&#10;")).ok()?;
                            }
                            let formula = if spills.is_some() && f.contains('#') {
                                super::xlsx_import::formula_tokens(
                                    f,
                                    &workbook.names,
                                    &formula_sheets,
                                    (Some(idx), Some(idx)),
                                    (0, 0),
                                    super::formula_arguments::Syntax::EditorXlsx,
                                    &mut work,
                                )?
                                .text
                            } else {
                                std::borrow::Cow::Borrowed(f.as_str())
                            };
                            let formula = if spills.is_some() {
                                super::formulas::xlsx_variables(&formula, &mut work)?
                            } else {
                                std::borrow::Cow::Borrowed(formula.as_ref())
                            };
                            write!(rows, ">{}</f>", escaped(&formula)).ok()?;
                        }
                        value.as_ref()
                    }
                };
                // A styled empty cell has no cached value. Writing zero changes
                // ISBLANK, COUNT and text-function results when Excel reopens it.
                if let Some(value) = value.filter(|v| is_formula || !matches!(v, Value::Empty)) {
                    let v = match value {
                        Value::Empty => "0".into(),
                        Value::Text(s) => escaped(s.as_str()),
                        Value::Error(s) => escaped(if rich_error.is_some() {
                            "#VALUE!"
                        } else {
                            error(s.as_str())
                        }),
                        Value::Bool(b) => u8::from(*b).to_string(),
                        Value::Number(n)
                            if is_formula
                                && *n == 0.
                                && cell
                                    .value_format
                                    .as_ref()
                                    .is_some_and(|f| f.as_str() == "BOOLEAN") =>
                        {
                            "0".into()
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
        let column_count = (end_col + 1).max(256).next_power_of_two();
        let selected = if idx == active {
            r#" tabSelected="1""#
        } else {
            ""
        };
        let mut view = String::new();
        for (name, enabled) in &sh.view {
            write!(view, r#" {name}="{}""#, u8::from(*enabled)).ok()?;
        }
        // IronCalc xlsx/export/worksheets.rs (f936620, MIT): split counts are
        // cell counts; the top-left cell belongs to the scrollable pane.
        let pane = if sh.frozen_rows == 0 && sh.frozen_columns == 0 {
            r#"<selection activeCell="A1" sqref="A1"/>"#.to_owned()
        } else {
            let active = match (sh.frozen_rows > 0, sh.frozen_columns > 0) {
                (true, true) => "bottomRight",
                (true, false) => "bottomLeft",
                _ => "topRight",
            };
            let cell = format!(
                "{}{}",
                xlsx_idx_to_col_ref(sh.frozen_columns),
                sh.frozen_rows + 1
            );
            format!(
                r#"<pane xSplit="{}" ySplit="{}" topLeftCell="{cell}" activePane="{active}" state="frozen"/><selection pane="{active}" activeCell="{cell}" sqref="{cell}"/>"#,
                sh.frozen_columns, sh.frozen_rows
            )
        };
        let mut outline = String::new();
        for (name, axes) in [("Row", &sh.rows), ("Col", &sh.columns)] {
            if let Some(level) = axes.values().map(|a| a.level).max().filter(|n| *n > 0) {
                write!(outline, r#" outlineLevel{name}="{level}""#).ok()?;
            }
        }
        let mut columns = String::new();
        let default = Axis::default();
        let mut start = 0;
        while start < column_count {
            let axis = sh.columns.get(&start).unwrap_or(&default);
            let mut end = start + 1;
            while end < column_count && sh.columns.get(&end).unwrap_or(&default) == axis {
                end += 1;
            }
            // Editable sheets carry their default width in sheetFormatPr.
            // Omit untouched runs so reopening a sparse sheet stays sparse.
            if sh.default_column_width.is_some() && axis == &default {
                start = end;
                continue;
            }
            let style = *format_ids.get(&("General", axis.style.as_deref()))?;
            write!(
                columns,
                r#"<col min="{}" max="{end}" style="{style}" width="{}""#,
                start + 1,
                attribute_number(
                    axis.size.or(sh.default_column_width).unwrap_or(48.)
                        / ((130. / 18.5703125) * (72. / 96.))
                )
            )
            .ok()?;
            if axis.size.is_some() {
                columns.push_str(r#" customWidth="1""#);
            }
            if axis.hidden {
                columns.push_str(r#" hidden="1""#);
            }
            if axis.level > 0 {
                write!(columns, r#" outlineLevel="{}""#, axis.level).ok()?;
            }
            columns.push_str("/>");
            if columns.len() > limit {
                return None;
            }
            start = end;
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
        let filter = if let Some(source) = &sh.filter {
            tables::filter(source, &filter_colors, limit)?
        } else {
            String::new()
        };
        let header = if sh.empty_headers {
            "<oddHeader/><oddFooter/>"
        } else {
            "<oddHeader>&amp;C&amp;A</oddHeader><oddFooter>&amp;CPage &amp;P</oddFooter>"
        };
        let margins = sh.print.margins.unwrap_or([None; 4]);
        let (fit, width, height, scale) = match sh.print.scale {
            Some(Scale::Fit(w, h)) => (1, w, h, 100.),
            Some(Scale::Percentage(s)) => (0, 0., 0., s),
            None => (0, 0., 0., 100.),
        };
        let mut hyperlinks = String::new();
        let mut sheet_rels = String::new();
        if !sh.hyperlinks.is_empty() {
            hyperlinks.push_str("<hyperlinks>");
            for (index, link) in sh.hyperlinks.iter().enumerate() {
                let escape = |s: &str| {
                    xml_escape_text(s)
                        .replace('\r', "&#13;")
                        .replace('\n', "&#10;")
                        .replace('\t', "&#9;")
                };
                work = work.checked_sub(
                    256 + link.reference.len()
                        + [
                            &link.target,
                            &link.target_mode,
                            &link.location,
                            &link.display,
                            &link.tooltip,
                        ]
                        .into_iter()
                        .flatten()
                        .map(String::len)
                        .sum::<usize>(),
                )?;
                write!(
                    hyperlinks,
                    r#"<hyperlink ref="{}""#,
                    escape(&link.reference)
                )
                .ok()?;
                if let Some(target) = &link.target {
                    write!(hyperlinks, r#" r:id="hyperlink{index}""#).ok()?;
                    write!(
                        sheet_rels,
                        r#"<Relationship Id="hyperlink{index}" Type="{REL}/hyperlink" Target="{}""#,
                        escape(target)
                    )
                    .ok()?;
                    if let Some(mode) = &link.target_mode {
                        write!(sheet_rels, r#" TargetMode="{}""#, escape(mode)).ok()?;
                    }
                    sheet_rels.push_str("/>");
                }
                for (name, value) in [
                    ("location", &link.location),
                    ("display", &link.display),
                    ("tooltip", &link.tooltip),
                ] {
                    if let Some(value) = value {
                        write!(hyperlinks, r#" {name}="{}""#, escape(value)).ok()?;
                    }
                }
                hyperlinks.push_str("/>");
            }
            hyperlinks.push_str("</hyperlinks>");
        }
        let mut table_parts = String::new();
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
        for (index, _) in workbook
            .pivots
            .values()
            .enumerate()
            .filter(|(_, pivot)| pivot.sheet == idx)
        {
            let id = index + 1;
            write!(sheet_rels, r#"<Relationship Id="pivot{id}" Type="{REL}/pivotTable" Target="../pivotTables/pivotTable{id}.xml"/>"#).ok()?;
        }
        let mut conditional = String::new();
        let mut extensions = String::new();
        for (id, rule) in workbook
            .conditional_formats
            .iter()
            .enumerate()
            .filter(|(_, r)| r.sheet == idx)
        {
            conditional.push_str(&super::conditional_xlsx::write(
                rule,
                id,
                workbook,
                &formula_sheets,
                &mut extensions,
                &mut work,
            )?);
        }
        let file = format!(
            include_str!("xlsx/worksheet.xml"),
            hyperlinks = hyperlinks,
            validations = super::validation::write(&sh.validations, &mut work)?,
            conditional = conditional,
            extensions = if extensions.is_empty() {
                String::new()
            } else {
                format!(
                    r#"<extLst><ext uri="{{78C0D931-6437-407D-A8EE-F0AAD7539E65}}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings>{extensions}</x14:conditionalFormattings></ext></extLst>"#
                )
            },
            fit = fit,
            fit_width = attribute_number(width),
            fit_height = attribute_number(height),
            scale = attribute_number(scale),
            orientation = sh.print.orientation.unwrap_or("portrait"),
            left = attribute_number(margins[0].unwrap_or(72.) / 72.),
            right = attribute_number(margins[1].unwrap_or(72.) / 72.),
            top = attribute_number(margins[2].unwrap_or(120.) / 72.),
            bottom = attribute_number(margins[3].unwrap_or(120.) / 72.),
            dimension = dimension,
            rows = rows,
            columns = if columns.is_empty() {
                String::new()
            } else {
                format!("<cols>{columns}</cols>")
            },
            selected = selected,
            view = view,
            pane = pane,
            outline = outline,
            default_row_height = attribute_number(sh.default_row_height.unwrap_or(12.75)),
            default_column_width = sh.default_column_width.map_or_else(
                || "9.142307692307693".into(),
                |n| attribute_number(n / ((130. / 18.5703125) * (72. / 96.))),
            ),
            merges = merges,
            filter = filter,
            tables = table_parts,
            header = header,
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
        if let Some(source) = &sh.filter {
            let expression = format!(
                "'{}'!{}",
                sh.name.as_str().replace('\'', "''"),
                tables::area(source.area, true)
            );
            write!(names, r#"<definedName name="_xlnm._FilterDatabase" localSheetId="{idx}" hidden="true">{}</definedName>"#, escaped(&expression)).ok()?;
        }
        let name = escaped(sh.name.as_str())
            .replace('\t', "&#9;")
            .replace('\n', "&#10;");
        add(format!("xl/worksheets/sheet{n}.xml"), file.into_bytes())?;
        sheet_types.push(format!(r#"<Override PartName="/xl/worksheets/sheet{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#));
        rels.push(format!(
            r#"<Relationship Id="rId{n}" Type="{REL}/worksheet" Target="worksheets/sheet{n}.xml"/>"#
        ));
        write!(
            nodes,
            r#"<sheet name="{name}" sheetId="{n}" r:id="rId{n}" state="{}"/>"#,
            sh.state
        )
        .ok()?;
        for (name, expression) in [
            (
                "Sheet_Title",
                format!("\"{}\"", sh.name.as_str().replace('"', "\"\"")),
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
            &workbook.conditional_formats,
            &filter_colors,
            limit,
        )?
        .into_bytes(),
    )?;
    for (name, data) in [
        (
            "docProps/app.xml",
            if dialect == Dialect::Gnumeric {
                include_bytes!("xlsx/app.xml").as_slice()
            } else {
                include_bytes!("xlsx/app-libreoffice.xml").as_slice()
            },
        ),
        ("docProps/core.xml", include_bytes!("xlsx/core.xml")),
        ("docProps/custom.xml", include_bytes!("xlsx/custom.xml")),
    ] {
        add(name.into(), data.to_vec())?;
    }
    let mut pivot_caches = String::new();
    for (index, _) in workbook.pivots.iter().enumerate() {
        let id = index + 1;
        let rel = rels.len() + 1;
        rels.push(format!(r#"<Relationship Id="rId{rel}" Type="{REL}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition{id}.xml"/>"#));
        write!(
            pivot_caches,
            r#"<pivotCache cacheId="{id}" r:id="rId{rel}"/>"#
        )
        .ok()?;
    }
    if !pivot_caches.is_empty() {
        pivot_caches = format!("<pivotCaches>{pivot_caches}</pivotCaches>");
    }
    add(
        "xl/workbook.xml".into(),
        format!(
            include_str!("xlsx/workbook.xml"),
            nodes = nodes,
            active = active,
            pivot_caches = pivot_caches,
            names = names,
            date1904 = u8::from(workbook.date1904),
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
    if has_dynamic || !rich_errors.is_empty() {
        let metadata = if rich_errors.is_empty() {
            include_bytes!("xlsx/dynamic-metadata.xml").to_vec()
        } else {
            let (metadata, values) =
                super::value_metadata::write(&rich_errors, has_dynamic, &mut work)?;
            for (name, kind, mime, content) in [
                (
                    "rdrichvalue.xml",
                    "rdRichValue",
                    "rdrichvalue",
                    values.into_bytes(),
                ),
                (
                    "rdrichvaluestructure.xml",
                    "rdRichValueStructure",
                    "rdrichvaluestructure",
                    include_bytes!("xlsx/rich-value-structure.xml").to_vec(),
                ),
                (
                    "rdRichValueTypes.xml",
                    "rdRichValueTypes",
                    "rdrichvaluetypes",
                    include_bytes!("xlsx/rich-value-types.xml").to_vec(),
                ),
            ] {
                add(format!("xl/richData/{name}"), content)?;
                rels.push(format!(r#"<Relationship Id="rId{}" Type="http://schemas.microsoft.com/office/2017/06/relationships/{kind}" Target="richData/{name}"/>"#,rels.len()+1));
                sheet_types.push(format!(r#"<Override PartName="/xl/richData/{name}" ContentType="application/vnd.ms-excel.{mime}+xml"/>"#));
            }
            metadata.into_bytes()
        };
        add("xl/metadata.xml".into(), metadata)?;
        rels.push(format!(
            r#"<Relationship Id="rId{}" Type="{REL}/sheetMetadata" Target="metadata.xml"/>"#,
            rels.len() + 1
        ));
        sheet_types.push(r#"<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>"#.into());
    }
    rels.reverse();
    add("xl/_rels/workbook.xml.rels".into(),format!("{XML}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}</Relationships>\n",rels.join("")).into_bytes())?;
    sheet_types.reverse();
    comment_types.reverse();
    add(
        "[Content_Types].xml".into(),
        format!(
            include_str!("xlsx/content-types.xml"),
            shared = shared,
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

// XML numeric attributes use JavaScript's shortest decimal representation;
// cell values below use Gnumeric's 17-digit representation.
fn attribute_number(n: f64) -> String {
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
pub(super) fn number(n: f64) -> String {
    if n == 0. {
        return n.to_string();
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
