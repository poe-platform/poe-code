//! Workbook colors used by filter snapshots and the available-color list.
use super::{LIMIT, Spreadsheet};
use std::collections::BTreeMap;

pub(super) fn values(
    book: &Spreadsheet,
    sheet: usize,
    area: [usize; 4],
    column: usize,
    font: bool,
    work: &mut usize,
) -> Result<Vec<Option<String>>, String> {
    let count = area[2].checked_sub(area[0]).ok_or(LIMIT)?;
    *work = work
        .checked_sub(count.checked_mul(192).ok_or(LIMIT)?)
        .ok_or(LIMIT)?;
    let positions = (area[0] + 1..=area[2])
        .map(|row| (row, area[1] + column))
        .collect::<Vec<_>>();
    // Evaluate conditional rules in one batch. Whole-column rules must not be
    // recalculated once per cell, nor create authored cells for styled blanks.
    let conditional = if book
        .options
        .conditional_formats
        .iter()
        .any(|rule| rule.sheet == sheet)
    {
        let budget = *work / 2;
        *work -= budget;
        book.conditional_styles(sheet, &positions, budget)?
    } else {
        BTreeMap::new()
    };
    positions
        .into_iter()
        .map(|(row, column)| {
            let base = book.cell_style(sheet, row, column);
            let overlay = conditional.get(&(row, column)).map(|value| &value.style);
            let attribute = |key| {
                overlay.into_iter().chain(base).find_map(|style| {
                    style
                        .attributes
                        .iter()
                        .find(|(name, _)| *name == key)
                        .map(|(_, value)| value.as_str())
                })
            };
            let overlay_fill =
                overlay.and_then(|style| style.attributes.iter().find(|(key, _)| *key == "Back"));
            let overlay_shade =
                overlay.and_then(|style| style.attributes.iter().find(|(key, _)| *key == "Shade"));
            // An authored conditional background without a pattern means solid;
            // it must override an inherited "no fill" pattern.
            let no_fill = overlay_shade
                .map(|(_, value)| value == "0")
                .unwrap_or_else(|| overlay_fill.is_none() && attribute("Shade") == Some("0"));
            let color = if font {
                Some(attribute("Fore").unwrap_or("FF000000"))
            } else if no_fill {
                None
            } else {
                attribute("Back")
            };
            color
                .map(|value| {
                    if value.len() != 8 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                        return Err("Invalid filter color".into());
                    }
                    // LibreOffice XlsColor::setRgb masks the unused alpha byte.
                    // Spreadsheet colors with 00 and FF prefixes look identical.
                    Ok(format!("FF{}", value[2..].to_ascii_uppercase()))
                })
                .transpose()
        })
        .collect()
}

fn palette(
    book: &Spreadsheet,
    sheet: usize,
    area: [usize; 4],
    column: usize,
    font: bool,
    limit: usize,
) -> Result<Vec<(Option<String>, usize)>, String> {
    let mut counts = BTreeMap::new();
    for color in values(book, sheet, area, column, font, &mut { limit })? {
        *counts.entry(color).or_insert(0) += 1;
    }
    Ok(counts.into_iter().collect())
}

impl Spreadsheet {
    /// Colors in an existing worksheet autofilter, without creating a table.
    pub fn sheet_filter_colors(
        &self,
        sheet: usize,
        column: usize,
        font: bool,
        limit: usize,
    ) -> Result<Vec<(Option<String>, usize)>, String> {
        let filter = self
            .sheets
            .get(sheet)
            .and_then(|s| s.filter.as_ref())
            .ok_or("Unknown worksheet filter")?;
        if column > filter.area[3] - filter.area[1] {
            return Err("Unknown filter column".into());
        }
        palette(self, sheet, filter.area, column, font, limit)
    }

    /// Distinct effective workbook colors, including styled blanks and
    /// conditional formatting. None denotes no fill; automatic text is black.
    pub fn table_filter_colors(
        &self,
        index: usize,
        column: usize,
        font: bool,
        limit: usize,
    ) -> Result<Vec<(Option<String>, usize)>, String> {
        let table = self.options.tables.get(index).ok_or("Unknown table")?;
        if !table.header {
            return Err("Table filters require a header row".into());
        }
        if column > table.area[3] - table.area[1] {
            return Err("Unknown table column".into());
        }
        let mut area = table.area;
        area[2] -= usize::from(table.totals);
        palette(self, table.sheet, area, column, font, limit)
    }
}
