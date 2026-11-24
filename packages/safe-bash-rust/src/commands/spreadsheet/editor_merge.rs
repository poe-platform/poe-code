// Merge semantics adapted from IronCalc's merged_cells.rs, commit
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT; see LICENSE.IronCalc).
use super::{Spreadsheet, model};
use std::sync::Arc;

fn valid([r, c, w, h]: [usize; 4]) -> bool {
    w > 0 && h > 0 && r < 1_048_576 && c < 16_384 && h <= 1_048_576 - r && w <= 16_384 - c
}

fn intersects([r, c, w, h]: [usize; 4], [row, col, width, height]: [usize; 4]) -> bool {
    r < row.saturating_add(height)
        && row < r.saturating_add(h)
        && c < col.saturating_add(width)
        && col < c.saturating_add(w)
}

fn pay(work: &mut usize, cost: usize) -> Result<(), String> {
    *work = work
        .checked_sub(cost)
        .ok_or("Merge exceeds its calculation limit")?;
    Ok(())
}

impl Spreadsheet {
    /// Returns the containing merge, including its anchor, without redirecting
    /// formula references to covered cells. Ranges use [row, column, width, height].
    pub fn merged_cell(&self, sheet: usize, row: usize, column: usize) -> Option<[usize; 4]> {
        self.sheets
            .get(sheet)?
            .merges
            .iter()
            .copied()
            .find(|&[r, c, w, h]| row >= r && row - r < h && column >= c && column - c < w)
    }

    /// Merge a batch atomically. At most one populated cell is allowed in each
    /// range; its content moves to the anchor with formula text unchanged.
    /// Pass one range per row/column for merge across/down.
    pub fn merge_cells(
        &mut self,
        sheet: usize,
        ranges: &[[usize; 4]],
        center: bool,
        limit: usize,
    ) -> Result<(), String> {
        let source = self.sheets.get(sheet).ok_or("Unknown sheet")?;
        if ranges.is_empty() {
            return Ok(());
        }
        let mut work = limit / 2;
        let mut contents = Vec::new();
        for (i, &range @ [r, c, w, h]) in ranges.iter().enumerate() {
            pay(&mut work, 256)?;
            if !valid(range) {
                return Err("Invalid merge range".into());
            }
            if w == 1 && h == 1 {
                return Err("Cannot merge a single cell".into());
            }
            if self.pivot_intersects(sheet, range) {
                return Err("Cannot merge cells that intersect a pivot table".into());
            }
            for previous in source.merges.iter().chain(&ranges[..i]) {
                pay(&mut work, 16)?;
                if intersects(range, *previous) {
                    return Err("Range intersects an existing merged cell".into());
                }
            }
            for array in &source.arrays {
                pay(&mut work, 16)?;
                if intersects(range, array.range) {
                    return Err("Cannot merge cells that intersect an array formula".into());
                }
            }
            for table in &self.options.tables {
                pay(&mut work, 16)?;
                let [top, left, bottom, right] = table.area;
                if table.sheet == sheet
                    && intersects(range, [top, left, right - left + 1, bottom - top + 1])
                {
                    return Err("Cannot merge cells that intersect a table".into());
                }
            }
            let mut content = None;
            for (&(row, col), cell) in source.cells.range((r, 0)..(r + h, 0)) {
                pay(&mut work, 32)?;
                if col < c || col - c >= w {
                    continue;
                }
                if cell.formula.is_some()
                    || cell.openformula.is_some()
                    || cell
                        .value
                        .as_ref()
                        .is_some_and(|v| !matches!(v, model::Value::Empty))
                {
                    if content.replace((row, col)).is_some() {
                        return Err("Cannot merge cells: more than one cell has content".into());
                    }
                }
            }
            let cell = source.cells.get(&content.unwrap_or((r, c)));
            // Style expansion is the only part that visits every covered cell.
            // Unstyled empty merges, including a whole sheet, remain sparse.
            if center || cell.is_some_and(|v| v.style.is_some() || v.format.is_some()) {
                let bytes = cell.map_or(0, |v| {
                    v.style
                        .as_ref()
                        .map_or(0, |s| s.retained_bytes())
                        .saturating_add(v.format.as_ref().map_or(0, String::len))
                });
                pay(
                    &mut work,
                    w.saturating_mul(h)
                        .saturating_mul(bytes.saturating_add(512)),
                )?;
            }
            contents.push(content.unwrap_or((r, c)));
        }
        let mut next = Self::from_json(&self.to_json(), limit / 2)?;
        for (&range @ [r, c, w, h], position) in ranges.iter().zip(contents) {
            let target = &mut next.sheets[sheet];
            let content = target.cells.get(&position).cloned();
            let format = content.as_ref().and_then(|cell| cell.format.clone());
            let mut style = content
                .as_ref()
                .and_then(|cell| cell.style.as_deref())
                .cloned();
            if center {
                let style = style.get_or_insert_with(Default::default);
                style.attributes.retain(|(k, _)| *k != "HAlign");
                style.attributes.push(("HAlign", "center".into()));
            }
            let existing: Vec<_> = target
                .cells
                .range((r, 0)..(r + h, 0))
                .filter(|((_, col), _)| *col >= c && *col - c < w)
                .map(|(key, _)| *key)
                .collect();
            for key in existing {
                target.cells.remove(&key);
            }
            if let Some(mut cell) = content {
                cell.value_format = None;
                target.cells.insert((r, c), cell);
            }
            if style.is_some() || format.is_some() {
                // At most nine border variants; share styles between cells.
                let mut styles = std::collections::BTreeMap::new();
                for row in r..r + h {
                    for col in c..c + w {
                        let edges = (row == r, row == r + h - 1, col == c, col == c + w - 1);
                        let shared = styles
                            .entry(edges)
                            .or_insert_with(|| {
                                style.as_ref().map(|style| {
                                    let mut style = style.clone();
                                    style.borders.retain(|(key, _, _)| match *key {
                                        "Top" => edges.0,
                                        "Bottom" => edges.1,
                                        "Left" => edges.2,
                                        "Right" => edges.3,
                                        _ => true,
                                    });
                                    Arc::new(style)
                                })
                            })
                            .clone();
                        let cell =
                            target
                                .cells
                                .entry((row, col))
                                .or_insert_with(|| model::TypedCell {
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
                        cell.style = shared;
                        cell.format = format.clone();
                    }
                }
            }
            target.merges.push(range);
        }
        next.spills = super::formulas::cache(&mut next.sheets, &next.options, None, work, true)
            .ok_or("Merge exceeds its calculation limit")?;
        *self = next;
        Ok(())
    }

    /// Remove every merge intersecting the selection; keep content and styles.
    pub fn unmerge_cells(
        &mut self,
        sheet: usize,
        range: [usize; 4],
        limit: usize,
    ) -> Result<(), String> {
        let target = self.sheets.get_mut(sheet).ok_or("Unknown sheet")?;
        if !valid(range) {
            return Err("Invalid merge range".into());
        }
        pay(&mut { limit }, target.merges.len().saturating_mul(16))?;
        target.merges.retain(|&merge| !intersects(range, merge));
        Ok(())
    }
}
