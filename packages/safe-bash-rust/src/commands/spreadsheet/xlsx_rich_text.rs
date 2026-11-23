use super::{escaped, text};
use std::{fmt::Write, sync::Arc};

// Preserve attribute insertion order for the workbook's shared-string identity.
#[derive(Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct TextRun {
    pub text: String,
    pub attributes: Arc<Vec<(&'static str, String)>>,
}

pub(super) fn write(runs: &[TextRun], limit: usize) -> Option<String> {
    let rich = runs.iter().any(|r| !r.attributes.is_empty());
    if !rich {
        let mut value = String::new();
        for run in runs {
            if run.text.len() > limit.saturating_sub(value.len()) {
                return None;
            }
            value.push_str(&run.text);
        }
        let out = text(&value);
        return (out.len() <= limit).then_some(out);
    }
    let mut out = String::new();
    for run in runs {
        let attr = |key| {
            run.attributes
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.as_str())
        };
        let mut props = String::new();
        for (key, name) in [
            ("bold", "b"),
            ("italic", "i"),
            ("strikethrough", "strike"),
            ("outline", "outline"),
            ("shadow", "shadow"),
        ] {
            if let Some(value) = attr(key) {
                write!(
                    props,
                    r#"<{name} val="{}"/>"#,
                    u8::from(value.parse::<f64>().ok()? != 0.)
                )
                .ok()?;
            }
        }
        if let Some(size) = attr("size") {
            let size = size.parse::<f64>().ok()?;
            let size = if size.is_finite() {
                (size / 1024.).to_string()
            } else {
                return None;
            };
            write!(props, r#"<sz val="{size}"/>"#).ok()?;
        }
        if let Some(family) = attr("family") {
            write!(
                props,
                r#"<rFont val="{}"/>"#,
                escaped(family).replace('\n', "&#10;").replace('\t', "&#9;")
            )
            .ok()?;
        }
        if let Some(family) = attr("font-family-class") {
            write!(props, r#"<family val="{family}"/>"#).ok()?;
        }
        if let Some(charset) = attr("font-charset") {
            write!(props, r#"<charset val="{charset}"/>"#).ok()?;
        }
        if let Some(color) = attr("color") {
            write!(props, r#"<color rgb="{color}"/>"#).ok()?;
        }
        if let Some(underline) = attr("underline") {
            write!(props, r#"<u val="{underline}"/>"#).ok()?;
        }
        let script = if attr("subscript") == Some("1") {
            Some("subscript")
        } else if attr("superscript") == Some("1") {
            Some("superscript")
        } else {
            None
        };
        if let Some(script) = script {
            write!(props, r#"<vertAlign val="{script}"/>"#).ok()?;
        }
        let props = if !props.is_empty() {
            format!("<rPr>{props}</rPr>")
        } else {
            String::new()
        };
        write!(out, "<r>{props}{}</r>", text(&run.text)).ok()?;
        if out.len() > limit {
            return None;
        }
    }
    Some(out)
}
