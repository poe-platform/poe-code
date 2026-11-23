//! Resolve workbook palettes once, before reading regular and differential styles.
use super::super::colors;
use super::{LIMIT, attr, elements, xml};

pub(in super::super) struct Palette {
    theme: [String; 12],
    indexed: Vec<Option<String>>,
}
fn argb(source: &str) -> Option<String> {
    if !matches!(source.len(), 6 | 8) || !source.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(if source.len() == 6 {
        format!("FF{source}")
    } else {
        source.into()
    })
}
impl Palette {
    pub(super) fn read(
        theme: &[xml::Node],
        styles: &[xml::Node],
        work: &mut usize,
    ) -> Result<Self, String> {
        *work = work.checked_sub(2048).ok_or(LIMIT)?;
        // SpreadsheetML swaps the DrawingML dark/light declaration order.
        // Defaults and theme slot mapping follow IronCalc's Office palette.
        let mut result = Self {
            theme: [
                "FFFFFFFF", "FF000000", "FFE7E6E6", "FF44546A", "FF4472C4", "FFED7D31", "FFA5A5A5",
                "FFFFC000", "FF5B9BD5", "FF70AD47", "FF0563C1", "FF954F72",
            ]
            .map(str::to_owned),
            indexed: Vec::new(),
        };
        if let Some(scheme) = elements(theme, "clrScheme").first() {
            for (i, name) in [
                "lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5",
                "accent6", "hlink", "folHlink",
            ]
            .iter()
            .enumerate()
            {
                if let Some(slot) = elements(&scheme.children, name).first() {
                    let color = elements(&slot.children, "srgbClr")
                        .first()
                        .and_then(|c| attr(c, "val"))
                        .or_else(|| {
                            elements(&slot.children, "sysClr")
                                .first()
                                .and_then(|c| attr(c, "lastClr"))
                        });
                    if let Some(color) = color.and_then(argb) {
                        result.theme[i] = color;
                    }
                }
            }
        }
        if let Some(palette) = elements(styles, "indexedColors").first() {
            for item in elements(&palette.children, "rgbColor").into_iter().take(64) {
                *work = work.checked_sub(64).ok_or(LIMIT)?;
                // Keep invalid entries in place so later colors retain their indexes.
                result.indexed.push(attr(item, "rgb").and_then(argb));
            }
        }
        Ok(result)
    }
    pub(in super::super) fn resolve(&self, element: &xml::Element) -> Option<String> {
        if matches!(attr(element, "auto"), Some("1" | "true")) {
            return None;
        }
        let color = if let Some(value) = attr(element, "rgb") {
            argb(value)?
        } else if let Some(index) = attr(element, "theme") {
            self.theme.get(index.parse::<usize>().ok()?)?.clone()
        } else if let Some(index) = attr(element, "indexed") {
            let index = index.parse::<usize>().ok()?;
            // 64/65 designate automatic system foreground/background colors.
            if index >= 64 {
                return None;
            }
            self.indexed
                .get(index)
                .and_then(|s| s.clone())
                .unwrap_or_else(|| format!("FF{}", &colors::get_indexed_color(index)[1..]))
        } else {
            return None;
        };
        let tint = attr(element, "tint")
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|n| n.is_finite() && (-1.0..=1.0).contains(n))
            .unwrap_or(0.0);
        if tint == 0.0 {
            return Some(color);
        }
        let tinted = colors::hex_with_tint_to_rgb(&format!("#{}", &color[2..]), tint);
        Some(format!("{}{}", &color[..2], &tinted[1..]))
    }
}
