use super::{escaped, text};
use crate::commands::structured::xlsx::{TextRun, display_number};
use std::fmt::Write;

#[derive(Default)]
pub(super) struct RichText {
    styles: Vec<(Vec<(&'static str, String)>, String)>,
}
impl RichText {
    pub fn register(
        &mut self,
        runs: &[TextRun],
        extended: bool,
        definitions: &mut super::definitions::Definitions,
    ) {
        for run in runs {
            if run.attributes.is_empty() || self.styles.iter().any(|(a, _)| *a == *run.attributes) {
                continue;
            }
            let a = |key| {
                run.attributes
                    .iter()
                    .find(|(k, _)| *k == key)
                    .map(|(_, v)| v.as_str())
            };
            let n = |key| a(key).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.);
            let mut properties = String::new();
            let mut attr = |key, value: &str| {
                write!(properties, " {key}=\"{}\"", escaped(value)).unwrap();
            };
            if let Some(family) = a("family") {
                let name = definitions.register(
                    "fonts",
                    "style:font-face",
                    "rtfont",
                    &format!(r#" svg:font-family="{}""#, escaped(family)),
                    "",
                );
                attr("style:font-name", &name);
            }
            if a("size").is_some() && n("size") >= 0. {
                attr(
                    "fo:font-size",
                    &format!("{}pt", display_number(n("size") / 1024.)),
                );
            }
            if a("bold").is_some() {
                let bold = n("bold");
                let scaled = bold * 300. + 400.;
                let nearest = scaled.round();
                let weight = if bold == (nearest - 400.) / 300. {
                    nearest
                } else {
                    scaled.trunc()
                };
                attr(
                    "fo:font-weight",
                    &match weight as i32 {
                        400 => "normal".into(),
                        700 => "bold".into(),
                        100..=900 => display_number(weight),
                        _ => if bold != 0. { "bold" } else { "normal" }.into(),
                    },
                );
            }
            if a("italic").is_some() {
                attr(
                    "fo:font-style",
                    if n("italic") != 0. {
                        "italic"
                    } else {
                        "normal"
                    },
                );
            }
            if a("strikethrough").is_some() {
                attr(
                    "style:text-line-through-style",
                    if n("strikethrough") != 0. {
                        "solid"
                    } else {
                        "none"
                    },
                );
            }
            if a("subscript").is_some() || a("superscript").is_some() {
                attr(
                    "style:text-position",
                    if n("subscript") != 0. {
                        "sub 83%"
                    } else if n("superscript") != 0. {
                        "super 83%"
                    } else {
                        "0% 100%"
                    },
                );
            }
            if let Some(color) = a("color") {
                attr(
                    "fo:color",
                    &format!("#{}", color.strip_prefix("FF").unwrap_or(color)),
                );
            }
            if let Some(underline) = a("underline") {
                let low = matches!(underline, "low" | "singleAccounting" | "doubleAccounting");
                let double = matches!(underline, "double" | "double-line" | "doubleAccounting");
                let enabled = low
                    || double
                    || matches!(underline, "single" | "single-line" | "error" | "error-line");
                attr(
                    "style:text-underline-style",
                    if enabled { "solid" } else { "none" },
                );
                attr(
                    "style:text-underline-type",
                    if !enabled {
                        "none"
                    } else if double {
                        "double"
                    } else {
                        "single"
                    },
                );
                attr("style:text-underline-width", "auto");
                attr("style:text-underline-color", "font-color");
                attr("style:text-underline-mode", "continuous");
                if extended && low {
                    attr("gnm:text-underline-placement", "low");
                }
            }
            if properties.is_empty() {
                continue;
            }
            let name = definitions.register(
                "content",
                "style:style",
                "rt",
                r#" style:family="text""#,
                &format!("<style:text-properties{properties}/>"),
            );
            self.styles.push((run.attributes.as_ref().clone(), name));
        }
    }
    pub fn content(&self, runs: &[TextRun], link: &str) -> String {
        let mut out = String::new();
        for run in runs {
            let content = linked(&run.text, link);
            if let Some((_, name)) = self.styles.iter().find(|(a, _)| *a == *run.attributes) {
                write!(
                    out,
                    r#"<text:span text:style-name="{name}">{content}</text:span>"#
                )
                .unwrap();
            } else {
                out.push_str(&content);
            }
        }
        out
    }
}

pub(super) fn linked(value: &str, link: &str) -> String {
    if link.is_empty() {
        text(value)
    } else {
        format!("{link}{}</text:a>", escaped(value))
    }
}
