//! Memory import scanning and conversation compaction primitives.
use mcp_protocol_rust::strings::trim_ecmascript;
use std::collections::HashSet;
pub fn parse_import_path(line: &[u16]) -> Option<Vec<u16>> {
    let line = trim_ecmascript(line);
    if line.first() != Some(&u16::from(b'@')) {
        return None;
    }
    let value = trim_ecmascript(&line[1..]);
    if value.is_empty()
        || value
            .iter()
            .any(|unit| trim_ecmascript(&[*unit]).is_empty())
    {
        return None;
    }
    if matches!(value.first(), Some(46 | 47)) || value.contains(&47) || value.contains(&92) {
        Some(value.to_vec())
    } else {
        None
    }
}
pub fn normalize_lines(content: &[u16]) -> Vec<Vec<u16>> {
    let mut lines = vec![vec![]];
    let mut index = 0;
    while index < content.len() {
        if content[index] == 13 && content.get(index + 1) == Some(&10) {
            index += 1;
        }
        if content[index] == 10 {
            lines.push(vec![]);
        } else {
            lines
                .last_mut()
                .expect("one initial line")
                .push(content[index]);
        }
        index += 1;
    }
    lines
}
#[derive(Default)]
pub struct MemoryLoading {
    paths: HashSet<Vec<u16>>,
}
impl MemoryLoading {
    pub fn enter(&mut self, path: Vec<u16>) -> bool {
        self.paths.insert(path)
    }
    pub fn leave(&mut self, path: &[u16]) {
        self.paths.remove(path);
    }
}
pub struct CompactionTail {
    remaining: f64,
}
impl CompactionTail {
    pub fn new(remaining: f64) -> Self {
        Self { remaining }
    }
    pub fn visit_user(&mut self) -> bool {
        self.remaining -= 1.0;
        self.remaining == 0.0
    }
}
pub fn format_compaction_summary(summary: &[u16]) -> Vec<u16> {
    let mut out = "Compacted context summary:\n"
        .encode_utf16()
        .collect::<Vec<_>>();
    out.extend(summary);
    out
}
pub fn render_file_awareness(mut read: Vec<Vec<u16>>, mut modified: Vec<Vec<u16>>) -> Vec<u16> {
    read.sort();
    modified.sort();
    let mut lines = vec![];
    for (label, paths) in [
        ("Files read before compaction:", read),
        ("Files modified before compaction:", modified),
    ] {
        if !paths.is_empty() {
            lines.push(label.encode_utf16().collect::<Vec<_>>());
            for path in paths {
                let mut line = "- ".encode_utf16().collect::<Vec<_>>();
                line.extend(path);
                lines.push(line);
            }
        }
    }
    let mut out = vec![];
    for (index, line) in lines.into_iter().enumerate() {
        if index > 0 {
            out.push(10);
        }
        out.extend(line);
    }
    out
}

pub enum Audit<T> {
    Tool(T),
    Compaction { summary: T, dropped_count: T },
}
pub fn audit_record<T>(timestamp: T, event: Audit<T>) -> crate::transcript::Node<T> {
    use crate::transcript::Node;
    let mut fields = vec![("ts", Node::Opaque(timestamp))];
    match event {
        Audit::Tool(tool) => fields.push(("tool", Node::Opaque(tool))),
        Audit::Compaction {
            summary,
            dropped_count,
        } => fields.extend([
            ("event", Node::String("compaction")),
            ("summary", Node::Opaque(summary)),
            ("droppedMessageCount", Node::Opaque(dropped_count)),
        ]),
    }
    Node::Object(fields)
}

/// Join host-coerced Git context sections while retaining all UTF16 units.
pub fn git_context(parts: &[Vec<u16>]) -> Result<Vec<u16>, &'static str> {
    let length = parts
        .iter()
        .try_fold(parts.len().saturating_sub(1), |sum, part| {
            sum.checked_add(part.len())
        })
        .filter(|length| *length <= 8388608)
        .ok_or("Git context exceeds the native output limit.")?;
    let mut output = Vec::with_capacity(length);
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            output.push(10);
        }
        output.extend_from_slice(part);
    }
    Ok(output)
}
