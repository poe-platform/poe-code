//! Flat syntax spans for source-preserving YAML mapping edits.
//! Semantic composition remains the YAML codec's responsibility.
use super::{
    Error,
    syntax::{
        parser::{Event, Parser},
        scanner::TScalarStyle,
    },
};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Scalar,
    Mapping,
    Sequence,
    Alias,
}
#[derive(Clone, Debug)]
pub struct Node {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
    pub text: Vec<u16>,
    pub quoted: bool,
    /// None for string scalars or collection nodes; non-string scalars retain schema types.
    pub scalar: Option<crate::value::Value>,
    pub flow: bool,
    pub children: Vec<usize>,
}
#[derive(Clone, Debug)]
pub struct Document {
    pub root: usize,
    pub nodes: Vec<Node>,
}
fn line_start(source: &[u16], offset: usize) -> usize {
    source[..offset.min(source.len())]
        .iter()
        .rposition(|u| *u == 10)
        .map_or(0, |i| i + 1)
}
pub fn scan(source: &[u16]) -> Result<Document, Error> {
    let mut parser = Parser::new(source.iter().copied());
    let mut nodes: Vec<Node> = vec![];
    let mut stack: Vec<usize> = vec![];
    let mut root = None;
    let mut documents = 0;
    loop {
        let (event, mark) = parser.next_token().map_err(|e| Error {
            reason: e.info().into(),
            offset: e.marker().index(),
            line: e.marker().line(),
            column: e.marker().col() + 1,
        })?;
        let start = mark.index().min(source.len());
        match event {
            Event::StreamEnd => break,
            Event::DocumentStart => {
                documents += 1;
                if documents > 1 {
                    return Err(Error {
                        reason: "Multiple YAML documents are not supported".into(),
                        offset: start,
                        line: mark.line(),
                        column: mark.col() + 1,
                    });
                }
            }
            Event::MappingEnd | Event::SequenceEnd => {
                let Some(index) = stack.pop() else {
                    return Err(Error {
                        reason: "Unbalanced YAML collection".into(),
                        offset: start,
                        line: mark.line(),
                        column: mark.col() + 1,
                    });
                };
                nodes[index].end = if nodes[index].flow {
                    (start + 1).min(source.len())
                } else if start == source.len() {
                    source.len()
                } else {
                    line_start(source, start)
                };
            }
            Event::Scalar(_, _, _, _)
            | Event::MappingStart(_, _)
            | Event::SequenceStart(_, _)
            | Event::Alias(_) => {
                if stack.len() >= 512 || nodes.len() >= 1_048_576 {
                    return Err(Error {
                        reason: "Maximum YAML document syntax budget exceeded".into(),
                        offset: start,
                        line: mark.line(),
                        column: mark.col() + 1,
                    });
                }
                let (kind, text, quoted, flow, scalar) = match event {
                    Event::Scalar(text, style, _, tag) => {
                        let resolved = super::scalar::resolve(
                            &String::from_utf16_lossy(&text),
                            style,
                            tag.as_ref(),
                            mark,
                            parser.version == (1, 1),
                        )?;
                        let scalar = if matches!(resolved, crate::value::Value::String(_)) {
                            None
                        } else {
                            Some(resolved)
                        };
                        (
                            Kind::Scalar,
                            text,
                            matches!(
                                style,
                                TScalarStyle::SingleQuoted | TScalarStyle::DoubleQuoted
                            ),
                            false,
                            scalar,
                        )
                    }
                    Event::MappingStart(_, _) => (
                        Kind::Mapping,
                        vec![],
                        false,
                        source.get(start) == Some(&123),
                        None,
                    ),
                    Event::SequenceStart(_, _) => (
                        Kind::Sequence,
                        vec![],
                        false,
                        source.get(start) == Some(&91),
                        None,
                    ),
                    Event::Alias(_) => (Kind::Alias, vec![], false, false, None),
                    _ => unreachable!(),
                };
                let index = nodes.len();
                nodes.push(Node {
                    kind,
                    start,
                    end: start,
                    text,
                    quoted,
                    scalar,
                    flow,
                    children: vec![],
                });
                if let Some(parent) = stack.last() {
                    nodes[*parent].children.push(index);
                } else {
                    root = Some(index);
                }
                if matches!(kind, Kind::Mapping | Kind::Sequence) {
                    stack.push(index);
                }
            }
            _ => {}
        }
    }
    let root = root.unwrap_or_else(|| {
        nodes.push(Node {
            kind: Kind::Scalar,
            start: 0,
            end: source.len(),
            text: vec![],
            quoted: false,
            scalar: None,
            flow: false,
            children: vec![],
        });
        nodes.len() - 1
    });
    // Leaf spans include following layout, ending at the next syntactic node.
    for index in 0..nodes.len() {
        if matches!(nodes[index].kind, Kind::Scalar | Kind::Alias) {
            nodes[index].end = nodes
                .get(index + 1)
                .map_or(source.len(), |next| next.start)
                .max(nodes[index].start);
        }
    }
    nodes[root].end = source.len();
    Ok(Document { root, nodes })
}
