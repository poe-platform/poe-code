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

#[napi(object)]
pub struct DesignAnsiBaseProperty {
    pub name: String,
    pub kind: u32,
    pub text: Option<Utf16String>,
    pub enabled: Option<bool>,
    pub number: Option<f64>,
}
#[napi(object)]
pub struct DesignAnsiProperty {
    pub name: String,
    pub base_index: Option<u32>,
    pub text: Option<Utf16String>,
    pub enabled: Option<bool>,
}
#[napi(object)]
pub struct DesignAnsiSegment {
    pub text: Utf16String,
    pub properties: Vec<DesignAnsiProperty>,
}
#[napi(object)]
pub struct DesignAnsiLine {
    pub segments: Vec<DesignAnsiSegment>,
}

#[napi]
pub fn design_ansi_style_fields() -> Vec<String> {
    toolcraft_design_rust::ansi_cells::STYLE_FIELDS
        .iter()
        .map(|name| (*name).to_owned())
        .collect()
}

#[napi]
pub fn design_ansi_lines(
    text: Utf16String,
    properties: Vec<DesignAnsiBaseProperty>,
    segment: Function<'_, Utf16String, DesignSegmentsReply>,
) -> Result<Vec<DesignAnsiLine>> {
    use toolcraft_design_rust::ansi_cells::{
        STYLE_FIELDS, Style, StyleProperty, StyleValue, styled_lines,
    };
    let properties = properties
        .into_iter()
        .enumerate()
        .map(|(index, property)| {
            let name = STYLE_FIELDS
                .iter()
                .find(|name| **name == property.name)
                .copied()
                .ok_or_else(|| Error::new(Status::InvalidArg, "Unknown ANSI style field"))?;
            let index = index as u32;
            let value = match property.kind {
                0 => StyleValue::Undefined,
                1 => StyleValue::Text(
                    property
                        .text
                        .map(|text| text.to_vec())
                        .unwrap_or_default()
                        .into(),
                ),
                2 => StyleValue::Boolean(property.enabled.unwrap_or(false)),
                3 => StyleValue::Number(property.number.unwrap_or(f64::NAN)),
                4 => StyleValue::Opaque(index),
                _ => return Err(Error::new(Status::InvalidArg, "Unknown ANSI style value")),
            };
            Ok(StyleProperty {
                name,
                value,
                base_index: Some(index),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let lines = styled_lines(&text, Style { properties }, &mut |text| {
        design_segments(&segment, text)
    })?;
    Ok(lines
        .into_iter()
        .map(|line| DesignAnsiLine {
            segments: line
                .into_iter()
                .map(|cell| DesignAnsiSegment {
                    text: cell.ch.into(),
                    properties: cell
                        .style
                        .properties
                        .into_iter()
                        .map(|property| {
                            let (text, enabled) = if property.base_index.is_some() {
                                (None, None)
                            } else {
                                match property.value {
                                    StyleValue::Text(text) => (Some(text.to_vec().into()), None),
                                    StyleValue::Boolean(value) => (None, Some(value)),
                                    _ => (None, None),
                                }
                            };
                            DesignAnsiProperty {
                                name: property.name.to_owned(),
                                base_index: property.base_index,
                                text,
                                enabled,
                            }
                        })
                        .collect(),
                })
                .collect(),
        })
        .collect())
}
