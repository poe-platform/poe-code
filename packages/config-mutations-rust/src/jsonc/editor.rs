// Editing and formatting rules adapted from jsonc-parser, Copyright Microsoft.
// Distributed under the MIT license; see THIRD_PARTY_NOTICES.md.
use super::scanner::{Kind, Scanner};
use super::{Data, Error, PathSegment, Value, compact, detect_indent, edit_error, tree, units};

fn apply(source: &[u16], start: usize, end: usize, replacement: &[u16]) -> Vec<u16> {
    let mut result = Vec::with_capacity(source.len() - (end - start) + replacement.len());
    result.extend_from_slice(&source[..start]);
    result.extend_from_slice(replacement);
    result.extend_from_slice(&source[end..]);
    result
}
/// A validated edit location. Wrapping host values before serialization keeps
/// toJSON's property-key argument and delays hooks until parent validation.
pub struct EditPlan {
    source: Vec<u16>,
    wrappers: Vec<PathSegment>,
    edit: Option<(usize, usize, Vec<u16>, bool)>,
}
impl EditPlan {
    pub fn wrappers(&self) -> &[PathSegment] {
        &self.wrappers
    }
    pub fn replaces_value(&self) -> bool {
        self.edit
            .as_ref()
            .is_some_and(|(start, end, prefix, value)| start < end && prefix.is_empty() && *value)
    }
    /// `serialized` must describe the already wrapped value. The host owns
    /// serialization hooks; no foreign objects or handles enter the core.
    pub fn apply_serialized(self, serialized: Option<&[u16]>) -> Vec<u16> {
        let Some((start, end, prefix, use_value)) = &self.edit else {
            return with_newline(self.source);
        };
        let mut replacement = prefix.clone();
        if *use_value {
            replacement.extend_from_slice(
                serialized.unwrap_or(&[117, 110, 100, 101, 102, 105, 110, 101, 100]),
            );
        }
        let mut result = apply(&self.source, *start, *end, &replacement);
        let mut begin = *start;
        let mut finish = start + replacement.len();
        if start == end || replacement.is_empty() {
            while begin > 0 && !matches!(result[begin - 1], 10 | 13) {
                begin -= 1;
            }
            while finish < result.len() && !matches!(result[finish], 10 | 13) {
                finish += 1;
            }
        }
        result = format_range(&result, begin, finish, &detect_indent(&self.source));
        with_newline(result)
    }
}
pub fn plan(source: Vec<u16>, path: &[PathSegment], has_value: bool) -> Result<EditPlan, Error> {
    let root = tree(&source)?;
    let mut remaining = path.len();
    let mut parent = None;
    let mut segment = None;
    let mut wrappers = vec![];
    while remaining > 0 {
        remaining -= 1;
        segment = Some(&path[remaining]);
        parent = root.as_ref().and_then(|node| node.find(&path[..remaining]));
        if parent.is_none() && has_value {
            wrappers.push(path[remaining].clone());
        } else {
            break;
        }
    }
    let edit = if let Some(parent) = parent {
        match (&parent.data, segment.unwrap()) {
            (Data::Object(properties), PathSegment::Key(key)) => {
                if let Some(index) = properties.iter().position(|(name, _, _)| name == key) {
                    let node = &properties[index].2;
                    if has_value {
                        Some((node.start, node.end, vec![], true))
                    } else {
                        let begin = if index > 0 {
                            properties[index - 1].2.end
                        } else {
                            parent.start + 1
                        };
                        let end = if index == 0 && properties.len() > 1 {
                            properties[1].1
                        } else {
                            node.end
                        };
                        Some((begin, end, vec![], false))
                    }
                } else if has_value {
                    let mut prefix = compact(&Value::String(key.clone()));
                    prefix.extend(units(": "));
                    let begin = properties.last().map_or(parent.start + 1, |p| p.2.end);
                    if !properties.is_empty() {
                        prefix.insert(0, 44);
                    }
                    Some((begin, begin, prefix, true))
                } else {
                    None
                }
            }
            (Data::Array(children), PathSegment::Index(index)) => {
                if *index == -1 {
                    let begin = children.last().map_or(parent.start + 1, |n| n.end);
                    Some((
                        begin,
                        begin,
                        if children.is_empty() {
                            vec![]
                        } else {
                            vec![44]
                        },
                        true,
                    ))
                } else if has_value {
                    let index =
                        usize::try_from(*index).map_err(|_| edit_error("Invalid array index"))?;
                    if let Some(node) = children.get(index) {
                        Some((node.start, node.end, vec![], true))
                    } else {
                        let begin = children.last().map_or(parent.start + 1, |n| n.end);
                        Some((
                            begin,
                            begin,
                            if children.is_empty() {
                                vec![]
                            } else {
                                vec![44]
                            },
                            true,
                        ))
                    }
                } else {
                    let index = usize::try_from(*index)
                        .ok()
                        .filter(|i| *i < children.len())
                        .ok_or_else(|| edit_error("Array index does not exist"))?;
                    if children.len() == 1 {
                        Some((parent.start + 1, parent.end - 1, vec![], false))
                    } else if index == children.len() - 1 {
                        Some((children[index - 1].end, children[index].end, vec![], false))
                    } else {
                        Some((
                            children[index].start,
                            children[index + 1].start,
                            vec![],
                            false,
                        ))
                    }
                }
            }
            _ => {
                return Err(edit_error(format!(
                    "Can not add {} to parent of type {}",
                    if matches!(segment, Some(PathSegment::Index(_))) {
                        "property"
                    } else {
                        "index"
                    },
                    parent.name()
                )));
            }
        }
    } else {
        if !has_value {
            return Err(edit_error("Can not delete in empty document"));
        }
        Some((
            root.as_ref().map_or(0, |n| n.start),
            root.as_ref().map_or(0, |n| n.end),
            vec![],
            true,
        ))
    };
    Ok(EditPlan {
        source,
        wrappers,
        edit,
    })
}
pub fn modify(
    source: &[u16],
    path: &[PathSegment],
    mut value: Option<Value>,
) -> Result<Vec<u16>, Error> {
    let plan = plan(source.to_vec(), path, value.is_some())?;
    for wrapper in plan.wrappers() {
        let child = value.take().unwrap();
        value = Some(match wrapper {
            PathSegment::Key(key) => Value::Object(vec![(key.clone(), child)]),
            PathSegment::Index(_) => Value::Array(vec![child]),
        });
    }
    let serialized = value.as_ref().map(compact);
    Ok(plan.apply_serialized(serialized.as_deref()))
}
fn with_newline(mut source: Vec<u16>) -> Vec<u16> {
    if source.last() != Some(&10) {
        source.push(10);
    }
    source
}

pub(super) fn format_range(
    source: &[u16],
    range_start: usize,
    range_end: usize,
    indent: &[u16],
) -> Vec<u16> {
    let mut begin = range_start;
    while begin > 0 && !matches!(source[begin - 1], 10 | 13) {
        begin -= 1;
    }
    let mut end = range_end;
    while end < source.len() && !matches!(source[end], 10 | 13) {
        end += 1;
    }
    let width = indent.len().max(1);
    let unit = if indent == [9] {
        vec![9]
    } else {
        vec![32; width]
    };
    let mut spaces = 0;
    for ch in &source[begin..end] {
        match ch {
            32 => spaces += 1,
            9 => spaces += width,
            _ => break,
        }
    }
    let base = spaces / width;
    let eol = source
        .iter()
        .position(|ch| matches!(ch, 10 | 13))
        .map_or(vec![10], |i| {
            if source[i] == 13 && source.get(i + 1) == Some(&10) {
                vec![13, 10]
            } else {
                vec![source[i]]
            }
        });
    let mut scanner = Scanner::new(&source[begin..end]);
    let mut current = scanner.next();
    let mut level = 0i64;
    let mut edits: Vec<(usize, usize, Vec<u16>)> = Vec::new();
    let add = |edits: &mut Vec<(usize, usize, Vec<u16>)>,
               a: usize,
               b: usize,
               text: Vec<u16>,
               valid: bool| {
        let a = a + begin;
        let b = b + begin;
        if valid && a < range_end && b > range_start && source[a..b] != text {
            edits.push((a, b, text));
        }
    };
    let line = |level: i64| {
        let mut out = eol.clone();
        for _ in 0..(base as i64 + level).max(0) {
            out.extend_from_slice(&unit);
        }
        out
    };
    if current.kind != Kind::Eof {
        add(
            &mut edits,
            0,
            current.start,
            unit.repeat(base),
            current.error.is_none(),
        );
    }
    while current.kind != Kind::Eof {
        let mut previous_end = current.end;
        let mut next = scanner.next();
        let mut replacement = vec![];
        let mut needs_break = false;
        while !next.line_break && matches!(next.kind, Kind::LineComment | Kind::BlockComment) {
            add(
                &mut edits,
                previous_end,
                next.start,
                vec![32],
                next.error.is_none(),
            );
            previous_end = next.end;
            needs_break = next.kind == Kind::LineComment;
            replacement = if needs_break { line(level) } else { vec![] };
            next = scanner.next();
        }
        let mut valid = next.error.is_none() && next.kind != Kind::Unknown;
        if matches!(next.kind, Kind::CloseObject | Kind::CloseArray) {
            let matching = if next.kind == Kind::CloseObject {
                Kind::OpenObject
            } else {
                Kind::OpenArray
            };
            if current.kind != matching {
                level -= 1;
                replacement = line(level);
            }
        } else {
            match current.kind {
                Kind::OpenObject | Kind::OpenArray => {
                    level += 1;
                    replacement = line(level);
                }
                Kind::Comma | Kind::LineComment => replacement = line(level),
                Kind::BlockComment => {
                    if next.line_break {
                        replacement = line(level);
                    } else if !needs_break {
                        replacement = vec![32];
                    }
                }
                Kind::Colon => {
                    if !needs_break {
                        replacement = vec![32];
                    }
                }
                Kind::String => {
                    if next.kind == Kind::Colon && !needs_break {
                        replacement.clear();
                    }
                }
                Kind::Null
                | Kind::True
                | Kind::False
                | Kind::Number
                | Kind::CloseObject
                | Kind::CloseArray => {
                    if matches!(next.kind, Kind::LineComment | Kind::BlockComment) && !needs_break {
                        replacement = vec![32];
                    } else if !matches!(next.kind, Kind::Comma | Kind::Eof) {
                        valid = false;
                    }
                }
                Kind::Unknown => valid = false,
                _ => {}
            }
            if next.line_break && matches!(next.kind, Kind::LineComment | Kind::BlockComment) {
                replacement = line(level);
            }
        }
        if next.kind == Kind::Eof {
            replacement.clear();
        }
        add(&mut edits, previous_end, next.start, replacement, valid);
        current = next;
    }
    // Apply ordered edits in one pass rather than repeatedly shifting the tail.
    let mut result = Vec::with_capacity(source.len());
    let mut cursor = 0;
    for (start, end, text) in edits {
        result.extend_from_slice(&source[cursor..start]);
        result.extend(text);
        cursor = end;
    }
    result.extend_from_slice(&source[cursor..]);
    result
}
