use super::{DesignSegmentsReply, design_segments};
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct DesignAnsiCells {
    pub text: Vec<Utf16String>,
    pub widths: Uint32Array,
    pub styles: Uint32Array,
}
#[napi]
pub fn design_ansi_cells(
    text: Utf16String,
    segment: Function<'_, Utf16String, DesignSegmentsReply>,
) -> Result<DesignAnsiCells> {
    let cells =
        toolcraft_design_rust::ansi_cells::cells(&text, |text| design_segments(&segment, text))?;
    let mut text = Vec::with_capacity(cells.len());
    let mut widths = Vec::with_capacity(cells.len());
    let mut styles = Vec::with_capacity(cells.len());
    for cell in cells {
        text.push(cell.ch.into());
        widths.push(cell.width);
        styles.push(cell.style);
    }
    Ok(DesignAnsiCells {
        text,
        widths: widths.into(),
        styles: styles.into(),
    })
}
