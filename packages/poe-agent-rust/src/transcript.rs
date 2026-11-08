//! ACP replay updates with opaque binding-host payload handles.
#[derive(Debug, PartialEq)]
pub enum Kind {
    Ignore,
    Message,
    Intent,
    Result,
    Error,
    Usage,
}
pub fn classify<F, E>(mut probe: F) -> Result<Kind, E>
where
    F: FnMut(&'static str) -> Result<bool, E>,
{
    for (label, kind) in [
        ("message.delta", Kind::Message),
        ("tool.intent", Kind::Intent),
        ("tool.result", Kind::Result),
        ("tool.error", Kind::Error),
        ("usage", Kind::Usage),
    ] {
        if probe(label)? {
            return Ok(kind);
        }
    }
    Ok(Kind::Ignore)
}
#[derive(Debug, PartialEq)]
pub enum Node<T> {
    Undefined,
    Bool(bool),
    String(&'static str),
    Utf16(Vec<u16>),
    Number(f64),
    Opaque(T),
    Object(Vec<(&'static str, Node<T>)>),
    Array(Vec<Node<T>>),
}
impl<T> Node<T> {
    pub fn try_map<U, E>(self, mapper: &mut impl FnMut(T) -> Result<U, E>) -> Result<Node<U>, E> {
        Ok(match self {
            Self::Undefined => Node::Undefined,
            Self::Bool(value) => Node::Bool(value),
            Self::String(value) => Node::String(value),
            Self::Utf16(value) => Node::Utf16(value),
            Self::Number(value) => Node::Number(value),
            Self::Opaque(value) => Node::Opaque(mapper(value)?),
            Self::Array(values) => Node::Array(
                values
                    .into_iter()
                    .map(|value| value.try_map(mapper))
                    .collect::<Result<_, _>>()?,
            ),
            Self::Object(fields) => Node::Object(
                fields
                    .into_iter()
                    .map(|(key, value)| Ok((key, value.try_map(mapper)?)))
                    .collect::<Result<_, E>>()?,
            ),
        })
    }
}
pub enum Event<T> {
    Ignore,
    Message {
        content: T,
        empty: bool,
    },
    Intent {
        id: T,
        subsequent_id: T,
        tool: T,
        args: T,
    },
    Result {
        id: T,
        result: T,
    },
    Error {
        id: T,
        error: T,
    },
    Usage {
        input: T,
        output: T,
        cached: T,
        creation: T,
        difference: f64,
    },
}
pub fn updates<T: Clone>(event: Event<T>) -> Vec<Node<T>> {
    use Node::{Number, Object, Opaque, String};
    match event {
        Event::Ignore | Event::Message { empty: true, .. } => vec![],
        Event::Message { content, .. } => vec![Object(vec![
            ("sessionUpdate", String("agent_message_chunk")),
            (
                "content",
                Object(vec![("type", String("text")), ("text", Opaque(content))]),
            ),
        ])],
        Event::Intent {
            id,
            subsequent_id,
            tool,
            args,
        } => vec![
            Object(vec![
                ("sessionUpdate", String("tool_call")),
                ("toolCallId", Opaque(id.clone())),
                ("title", Opaque(tool)),
                ("kind", String("execute")),
                ("status", String("pending")),
                ("rawInput", Opaque(args)),
            ]),
            Object(vec![
                ("sessionUpdate", String("tool_call_update")),
                ("toolCallId", Opaque(subsequent_id)),
                ("kind", String("execute")),
                ("status", String("in_progress")),
            ]),
        ],
        Event::Result { id, result } => vec![Object(vec![
            ("sessionUpdate", String("tool_call_update")),
            ("toolCallId", Opaque(id)),
            ("kind", String("execute")),
            ("status", String("completed")),
            ("rawOutput", Opaque(result)),
        ])],
        Event::Error { id, error } => vec![Object(vec![
            ("sessionUpdate", String("tool_call_update")),
            ("toolCallId", Opaque(id)),
            ("kind", String("execute")),
            ("status", String("failed")),
            ("rawOutput", Opaque(error)),
        ])],
        Event::Usage {
            input,
            output,
            cached,
            creation,
            difference,
        } => vec![Object(vec![
            ("sessionUpdate", String("usage_update")),
            (
                "used",
                Number(if difference.is_nan() {
                    f64::NAN
                } else {
                    if difference <= 0.0 { 0.0 } else { difference }
                }),
            ),
            ("size", Opaque(input.clone())),
            (
                "_meta",
                Object(vec![
                    ("inputTokens", Opaque(input)),
                    ("outputTokens", Opaque(output)),
                    ("cachedTokens", Opaque(cached)),
                    ("cacheCreationTokens", Opaque(creation)),
                ]),
            ),
        ])],
    }
}
