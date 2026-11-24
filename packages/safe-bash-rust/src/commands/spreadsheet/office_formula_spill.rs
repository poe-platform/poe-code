// Dynamic spill scheduling follows IronCalc's evaluation.rs: remember reads
// of empty positions, then restart with a producer before a reader whose input
// it changes. MIT, LICENSE.IronCalc, f93662006b8fb1c401dc870bbda26c5d60ac6037.
// Derived values stay outside authored cells and outside the sync document.
use super::{Calculation, Coord, Value};
use crate::commands::spreadsheet::model::Value as CellValue;
use std::collections::{BTreeMap, BTreeSet};

pub(in super::super) struct SpillCache {
    pub calculated_at_ms: f64,
    pub styles: BTreeMap<Coord, std::sync::Arc<super::super::model::Style>>,
    pub values: BTreeMap<Coord, CellValue<String>>,
    pub ranges: BTreeMap<Coord, [usize; 2]>,
    pub pivot_ranges: BTreeMap<Coord, [usize; 2]>,
    pub pivot_sources: BTreeMap<Coord, (usize, [usize; 4])>,
}

impl Default for SpillCache {
    fn default() -> Self {
        Self {
            calculated_at_ms: super::clock::now_ms(),
            styles: BTreeMap::new(),
            values: BTreeMap::new(),
            ranges: BTreeMap::new(),
            pivot_ranges: BTreeMap::new(),
            pivot_sources: BTreeMap::new(),
        }
    }
}

#[derive(Default)]
pub(super) struct Dynamic {
    pub root: Option<Coord>,
    pub occupied: BTreeSet<Coord>,
    pub blocked: Vec<(usize, [usize; 4])>,
    pub cells: BTreeSet<Coord>,
    pub ranges: BTreeMap<Coord, [usize; 2]>,
    pub circular: BTreeSet<Coord>,
    reads: Vec<(Coord, Coord, Coord)>,
    edges: BTreeSet<(Coord, Coord)>,
    changed: bool,
}

impl Dynamic {
    pub fn dependency(&mut self, producer: Coord, work: &mut usize) -> Option<()> {
        if let Some(reader) = self.root {
            *work = work.checked_sub(64)?;
            self.edges.insert((producer, reader));
        }
        Some(())
    }

    pub fn order(&mut self, formulas: &[Coord], work: &mut usize) -> Option<Vec<Coord>> {
        loop {
            *work = work.checked_sub(formulas.len().checked_mul(128)?)?;
            let mut remaining: BTreeMap<_, BTreeSet<_>> =
                formulas.iter().map(|&p| (p, BTreeSet::new())).collect();
            let mut readers: BTreeMap<Coord, Vec<Coord>> = BTreeMap::new();
            for &(producer, reader) in &self.edges {
                *work = work.checked_sub(64)?;
                if !self.circular.contains(&producer) && !self.circular.contains(&reader) {
                    remaining.get_mut(&reader)?.insert(producer);
                    readers.entry(producer).or_default().push(reader);
                }
            }
            let mut ready: BTreeSet<_> = remaining
                .iter()
                .filter(|(_, deps)| deps.is_empty())
                .map(|(&p, _)| p)
                .collect();
            let mut ordered = Vec::with_capacity(formulas.len());
            while let Some(coord) = ready.pop_first() {
                ordered.push(coord);
                remaining.remove(&coord);
                if let Some(dependents) = readers.get(&coord) {
                    for reader in dependents {
                        *work = work.checked_sub(1)?;
                        if let Some(deps) = remaining.get_mut(reader) {
                            if deps.remove(&coord) && deps.is_empty() {
                                ready.insert(*reader);
                            }
                        }
                    }
                }
            }
            if remaining.is_empty() {
                return Some(ordered);
            }
            // Only the cycle is forced to an error. Downstream IFERROR readers
            // must still evaluate normally and can recover from that error.
            let mut path = Vec::new();
            let mut current = *remaining.keys().next()?;
            loop {
                *work = work.checked_sub(path.len() + 64)?;
                if let Some(first) = path.iter().position(|p| *p == current) {
                    self.circular.extend(path[first..].iter().copied());
                    break;
                }
                path.push(current);
                current = *remaining.get(&current)?.iter().next()?;
            }
        }
    }
}

impl Calculation<'_> {
    pub(super) fn read_spill_range(&mut self, a: Coord, b: Coord) -> Option<()> {
        if let Some(dynamic) = &mut self.dynamic {
            self.work = self.work.checked_sub(96)?;
            if let Some(root) = dynamic.root {
                dynamic.reads.push((root, a, b));
            }
        }
        Some(())
    }

    pub(super) fn spill_result(
        &mut self,
        anchor: Coord,
        value: Value,
        depth: usize,
    ) -> Option<Value> {
        let rows = match value {
            Value::Matrix(rows) => rows,
            Value::Range(a, b) if a.0 == b.0 => self.matrix(Value::Range(a, b), depth + 1)?,
            value => return Some(value),
        };
        let height = rows.len();
        let width = rows.first().map_or(0, Vec::len);
        if height == 0 || width == 0 || rows.iter().any(|row| row.len() != width) {
            return Some(Value::Error("#CALC!"));
        }
        if height > 1_048_576 - anchor.1 || width > 16_384 - anchor.2 {
            return Some(Value::Error("#SPILL!"));
        }
        let dynamic = self.dynamic.as_ref()?;
        let end = (anchor.0, anchor.1 + height - 1, anchor.2 + width - 1);
        for &(s, [r, c, w, h]) in &dynamic.blocked {
            self.work = self.work.checked_sub(1)?;
            if s == anchor.0 && r <= end.1 && c <= end.2 && r + h > anchor.1 && c + w > anchor.2 {
                return Some(Value::Error("#SPILL!"));
            }
        }
        for r in anchor.1..=end.1 {
            for c in anchor.2..=end.2 {
                self.tick(depth)?;
                let pos = (anchor.0, r, c);
                let dynamic = self.dynamic.as_ref()?;
                if pos != anchor
                    && (dynamic.occupied.contains(&pos) || dynamic.cells.contains(&pos))
                {
                    return Some(Value::Error("#SPILL!"));
                }
            }
        }
        let dynamic = self.dynamic.as_mut()?;
        for &(root, a, b) in &dynamic.reads {
            self.work = self.work.checked_sub(1)?;
            if (a.0.min(b.0)..=a.0.max(b.0)).contains(&anchor.0)
                && a.1.min(b.1) <= end.1 && a.1.max(b.1) >= anchor.1
                && a.2.min(b.2) <= end.2 && a.2.max(b.2) >= anchor.2
                // Reading only the anchor is an ordinary formula dependency.
                && !(a == anchor && b == anchor)
            {
                self.work = self.work.checked_sub(64)?;
                // An ordinary anchor dependency may already exist, but this
                // range reader still missed children created during this pass.
                dynamic.edges.insert((anchor, root));
                dynamic.changed = true;
            }
        }
        self.work = self.work.checked_sub(64)?;
        dynamic.ranges.insert(anchor, [width, height]);
        let mut first = Value::Blank;
        let pivot = self.pivot_anchors.contains_key(&anchor);
        for (r, row) in rows.into_iter().enumerate() {
            for (c, value) in row.into_iter().enumerate() {
                let value = match value {
                    // Pivot label gaps are real empty cells, not array-formula blanks.
                    Value::Empty if pivot => Value::Empty,
                    Value::Blank | Value::Empty => Value::Number(0.),
                    Value::LiteralError(e) => Value::Error(e),
                    value => value,
                };
                if (r, c) == (0, 0) {
                    first = value;
                } else {
                    self.work = self.work.checked_sub(160)?;
                    let coord = (anchor.0, anchor.1 + r, anchor.2 + c);
                    dynamic.cells.insert(coord);
                    self.values.insert(coord, value);
                }
            }
        }
        Some(first)
    }

    pub(super) fn restart_spills(&mut self) -> Option<bool> {
        let dynamic = self.dynamic.as_mut()?;
        if !dynamic.changed {
            return Some(false);
        }
        dynamic.changed = false;
        dynamic.reads.clear();
        dynamic.ranges.clear();
        for coord in std::mem::take(&mut dynamic.cells) {
            self.values.remove(&coord);
        }
        for coord in &self.automatic_formats {
            self.formats.remove(coord);
        }
        self.results.clear();
        self.matrices.clear();
        Some(true)
    }
}

pub(super) fn cell_value(value: Value) -> Option<CellValue<String>> {
    Some(match value {
        Value::Blank => CellValue::Number(0.),
        Value::Empty => CellValue::Empty,
        Value::Number(n) => CellValue::Number(n),
        Value::Bool(b) => CellValue::Bool(b),
        Value::Text(s) | Value::UninternedText(s) => CellValue::Text(s),
        Value::Error(e) | Value::LiteralError(e) => CellValue::Error(e.into()),
        _ => return None,
    })
}
