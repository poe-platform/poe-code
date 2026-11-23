use super::{Axis, Spreadsheet};

impl Spreadsheet {
    /// Set a range of row heights or column widths in CSS pixels. None restores
    /// the default size. Hidden state, outline levels, styles and cells survive.
    /// Validate the complete batch before touching the sparse metadata; sizing
    /// does not invalidate formula caches or recalculate the workbook.
    pub fn resize_axis(
        &mut self,
        sheet: usize,
        columns: bool,
        start: usize,
        count: usize,
        pixels: Option<f64>,
        limit: usize,
    ) -> Result<(), String> {
        let maximum = if columns { 16_384 } else { 1_048_576 };
        let end = start
            .checked_add(count)
            .filter(|&end| count > 0 && end <= maximum)
            .ok_or("Size range is outside the worksheet")?;
        // Excel permits 409.5-point rows and 255-character columns. Use the
        // same column-width conversion as the existing XLSX writer.
        let maximum_size = if columns {
            255. * 130. / 18.5703125
        } else {
            546.
        };
        if pixels.is_some_and(|n| !n.is_finite() || n < 1. || n > maximum_size) {
            return Err(format!(
                "{} must be between 1 and {} pixels",
                if columns {
                    "Column width"
                } else {
                    "Row height"
                },
                maximum_size.floor()
            ));
        }
        count
            .checked_mul(std::mem::size_of::<Axis>() + 128)
            .filter(|&work| work <= limit)
            .ok_or("Size edit exceeds its work limit")?;
        let sheet = self.sheets.get_mut(sheet).ok_or("Sheet no longer exists")?;
        let axes = if columns {
            &mut sheet.columns
        } else {
            &mut sheet.rows
        };
        for index in start..end {
            if let Some(pixels) = pixels {
                axes.entry(index).or_default().size = Some(pixels * 72. / 96.);
            } else if let Some(axis) = axes.get_mut(&index) {
                axis.size = None;
                if *axis == Axis::default() {
                    axes.remove(&index);
                }
            }
        }
        Ok(())
    }
}
