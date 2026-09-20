//! Frontmatter policy using the own Rust YAML parser.
use config_mutations_rust::{value::Value, yaml};
pub const MISSING_END: &str = "Missing YAML frontmatter end delimiter (---).";
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Inspection {
    Body,
    Missing {
        raw_start: usize,
        raw_end: usize,
    },
    Frontmatter {
        raw_start: usize,
        raw_end: usize,
        body_start: usize,
    },
}
fn line_end(source: &[u16], start: usize) -> (usize, usize) {
    let mut index = start;
    while index < source.len() {
        match source[index] {
            10 => return (index, 1),
            13 => {
                return (
                    index,
                    if source.get(index + 1) == Some(&10) {
                        2
                    } else {
                        1
                    },
                );
            }
            _ => index += 1,
        }
    }
    (source.len(), 0)
}
fn fence(line: &[u16]) -> bool {
    line.starts_with(&[45, 45, 45]) && line[3..].iter().all(|unit| matches!(unit, 32 | 9))
}
pub fn inspect(source: &[u16]) -> Inspection {
    let offset = usize::from(source.first() == Some(&0xfeff));
    let (opening, ending) = line_end(source, offset);
    if ending == 0 || !fence(&source[offset..opening]) {
        return Inspection::Body;
    }
    let raw_start = opening + ending;
    let mut line = raw_start;
    loop {
        let (end, ending) = line_end(source, line);
        if fence(&source[line..end]) {
            return Inspection::Frontmatter {
                raw_start,
                raw_end: line,
                body_start: end + ending,
            };
        }
        if ending == 0 {
            return Inspection::Missing {
                raw_start,
                raw_end: source.len(),
            };
        }
        line = end + ending;
    }
}
pub fn normalize_line_endings(source: &[u16]) -> Vec<u16> {
    source
        .iter()
        .enumerate()
        .map(|(index, unit)| {
            if *unit == 13 && source.get(index + 1) != Some(&10) {
                10
            } else {
                *unit
            }
        })
        .collect()
}
pub fn line_starts(source: &[u16]) -> Vec<usize> {
    let mut output = vec![0];
    let mut index = 0;
    while index < source.len() {
        match source[index] {
            10 => output.push(index + 1),
            13 => {
                if source.get(index + 1) == Some(&10) {
                    index += 1;
                }
                output.push(index + 1);
            }
            _ => {}
        }
        index += 1;
    }
    output
}
pub fn line_position(starts: &[usize], offset: usize) -> (usize, usize) {
    let index = starts.partition_point(|start| *start < offset);
    if starts.get(index) == Some(&offset) {
        (index + 1, 1)
    } else if index == 0 {
        (0, offset)
    } else {
        (index, offset - starts[index - 1] + 1)
    }
}
pub fn diagnostic_offset(raw: &[u16], offset: usize) -> usize {
    if offset < raw.len() || !matches!(raw.last(), Some(10 | 13)) {
        return offset;
    }
    let mut index = raw.len() - 1;
    if raw[index] == 10 && index > 0 && raw[index - 1] == 13 {
        index -= 1;
    }
    while index > 0 && !matches!(raw[index - 1], 10 | 13) {
        index -= 1;
    }
    index
}
pub fn diagnostic_message(reason: &str, at_eof: bool) -> String {
    if at_eof && reason.contains("flow sequence") {
        "Flow sequence in block collection must be sufficiently indented and end with a ]".into()
    } else if at_eof && reason.contains("flow mapping") {
        "Flow map in block collection must be sufficiently indented and end with a }".into()
    } else {
        reason.into()
    }
}
#[derive(Debug)]
pub struct Diagnostic {
    pub message: String,
    pub position: Option<(usize, usize)>,
    pub parse_message: String,
}
#[derive(Debug)]
pub struct Document {
    pub yaml: yaml::Parsed,
    pub body_start: usize,
    pub errors: Vec<Diagnostic>,
}
fn empty_document(body_start: usize) -> Document {
    Document {
        yaml: yaml::Parsed {
            value: Value::Object(vec![]),
            date_ids: vec![],
            symbol_ids: vec![],
        },
        body_start,
        errors: vec![],
    }
}
pub fn parse_document(
    source: &[u16],
    unique_keys: bool,
    date_key: Option<&mut dyn FnMut(i64) -> Vec<u16>>,
) -> Document {
    let (start, end, body_start) = match inspect(source) {
        Inspection::Body => return empty_document(0),
        Inspection::Missing { .. } => {
            let mut document = empty_document(source.len());
            document.errors.push(Diagnostic {
                message: MISSING_END.into(),
                position: Some((source.len(), source.len())),
                parse_message: MISSING_END.into(),
            });
            return document;
        }
        Inspection::Frontmatter {
            raw_start,
            raw_end,
            body_start,
        } => (raw_start, raw_end, body_start),
    };
    let raw = &source[start..end];
    match yaml::parse_with_options(
        &normalize_line_endings(raw),
        date_key,
        yaml::ParseOptions {
            unique_keys,
            object_root: false,
        },
    ) {
        Ok(mut parsed) => {
            if parsed.value == Value::Null {
                parsed.value = Value::Object(vec![]);
            }
            if matches!(parsed.value, Value::Object(_)) {
                Document {
                    yaml: parsed,
                    body_start,
                    errors: vec![],
                }
            } else {
                let mut document = empty_document(body_start);
                let message = "YAML frontmatter must parse to an object.";
                document.errors.push(Diagnostic {
                    message: message.into(),
                    position: None,
                    parse_message: message.into(),
                });
                document
            }
        }
        Err(error) => {
            let mut document = empty_document(body_start);
            let at_eof = error.offset >= raw.len();
            let offset = start + diagnostic_offset(raw, error.offset);
            document.errors.push(Diagnostic {
                message: diagnostic_message(&error.reason, at_eof),
                position: Some((offset, offset + usize::from(!at_eof))),
                parse_message: format!("Invalid YAML frontmatter: {error}"),
            });
            document
        }
    }
}
