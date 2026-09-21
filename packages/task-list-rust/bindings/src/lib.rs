use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi]
pub fn task_can_fire(from: Option<Vec<Utf16String>>, to: Utf16String, state: Utf16String) -> bool {
    let from = from.map(|values| values.into_iter().map(|v| v.to_vec()).collect::<Vec<_>>());
    task_list_rust::can_fire(from.as_deref(), &to, &state)
}
#[napi]
pub fn task_visible_name(value: Utf16String) -> bool {
    task_list_rust::visible_name(&value)
}
#[napi]
pub fn task_printable_identifier(value: Utf16String) -> bool {
    task_list_rust::printable_identifier(&value)
}
#[napi]
pub fn task_valid_id(value: Utf16String) -> bool {
    task_list_rust::task_id(&value)
}
#[napi(object)]
pub struct TaskDocument {
    pub frontmatter: Utf16String,
    pub body: Utf16String,
}
#[napi]
pub fn task_split_document(content: Utf16String, passthrough: bool) -> Option<TaskDocument> {
    task_list_rust::markdown::split_document(&content, passthrough).map(|(frontmatter, body)| {
        TaskDocument {
            frontmatter: frontmatter.into(),
            body: body.into(),
        }
    })
}
#[napi(object)]
pub struct TaskFilename {
    pub id: Utf16String,
    pub order: Option<f64>,
}
#[napi]
pub fn task_active_filename(filename: Utf16String) -> Option<TaskFilename> {
    task_list_rust::markdown::active_filename(&filename).map(|(id, order)| TaskFilename {
        id: id.into(),
        order,
    })
}
pub use config_mutations_rust_napi_core::*;
#[napi]
pub fn task_gh_issue_number(id: Utf16String) -> Option<f64> {
    task_list_rust::github::issue_number(&id).map(|n| n as f64)
}
#[napi(object)]
pub struct TaskGhRepo {
    pub owner: Utf16String,
    pub name: Utf16String,
}
#[napi]
pub fn task_gh_repo(repo: Utf16String) -> Option<TaskGhRepo> {
    task_list_rust::github::parse_repo(&repo).map(|(owner, name)| TaskGhRepo {
        owner: owner.into(),
        name: name.into(),
    })
}
#[napi]
pub fn task_gh_json(
    source: Utf16String,
) -> napi::Result<mcp_protocol_rust_napi_core::convert::NativeJson> {
    mcp_protocol_rust::json::parse_utf16(
        &source,
        mcp_protocol_rust::json::Limits {
            max_bytes: usize::MAX,
            max_nodes: usize::MAX,
            max_depth: 512,
        },
    )
    .map(mcp_protocol_rust_napi_core::convert::NativeJson)
    .map_err(|error| napi::Error::from_reason(error.to_string()))
}
#[path = "../../../process-runner-rust/bindings/src/lib.rs"]
mod runner;
pub use runner::*;
#[napi]
pub const USER_ERROR_NAME: &str = user_error_rust::USER_ERROR_NAME;
#[napi]
pub fn task_yaml_spans(
    source: Utf16String,
) -> napi::Result<mcp_protocol_rust_napi_core::convert::NativeJson> {
    use config_mutations_rust::yaml::document::Kind;
    use mcp_protocol_rust::json::Value;
    let document = config_mutations_rust::yaml::document::scan(&source)
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let field = |key: &str, value: Value| (key.encode_utf16().collect(), value);
    let nodes = document
        .nodes
        .into_iter()
        .map(|node| {
            let scalar = node
                .scalar
                .map(|value| {
                    let date_ids = if matches!(value, config_mutations_rust::value::Value::Date(_))
                    {
                        vec![0]
                    } else {
                        vec![]
                    };
                    let symbol_ids =
                        if matches!(value, config_mutations_rust::value::Value::Symbol(_)) {
                            vec![0]
                        } else {
                            vec![]
                        };
                    config_mutations_rust_napi_core::parsed_yaml_snapshot(
                        config_mutations_rust::yaml::Parsed {
                            value,
                            date_ids,
                            symbol_ids,
                        },
                    )
                    .0
                })
                .unwrap_or(Value::Null);
            Value::Object(vec![
                field("scalar", scalar),
                field(
                    "kind",
                    Value::String(
                        match node.kind {
                            Kind::Scalar => "scalar",
                            Kind::Mapping => "mapping",
                            Kind::Sequence => "sequence",
                            Kind::Alias => "alias",
                        }
                        .encode_utf16()
                        .collect(),
                    ),
                ),
                field("start", Value::Number(node.start as f64)),
                field("end", Value::Number(node.end as f64)),
                field("text", Value::String(node.text)),
                field("quoted", Value::Bool(node.quoted)),
                field("flow", Value::Bool(node.flow)),
                field(
                    "children",
                    Value::Array(
                        node.children
                            .into_iter()
                            .map(|i| Value::Number(i as f64))
                            .collect(),
                    ),
                ),
            ])
        })
        .collect();
    Ok(mcp_protocol_rust_napi_core::convert::NativeJson(
        Value::Object(vec![
            field("root", Value::Number(document.root as f64)),
            field("nodes", Value::Array(nodes)),
        ]),
    ))
}
#[napi(object)]
pub struct TaskSearchFrame {
    pub state: Utf16String,
    pub events: Vec<Utf16String>,
}
#[napi]
pub struct NativeTaskSearch {
    search: task_list_rust::migration::Search,
}
#[napi]
impl NativeTaskSearch {
    #[napi(constructor)]
    pub fn new(initial: Utf16String) -> napi::Result<Self> {
        task_list_rust::migration::Search::new(initial.to_vec())
            .map(|search| Self { search })
            .map_err(napi::Error::from_reason)
    }
    #[napi(js_name = "next")]
    pub fn next_frame(&mut self) -> Option<TaskSearchFrame> {
        self.search.next().map(|(state, events)| TaskSearchFrame {
            state: state.into(),
            events: events.into_iter().map(Utf16String::from).collect(),
        })
    }
    #[napi]
    pub fn has(&self, state: Utf16String) -> bool {
        self.search.has(&state)
    }
    #[napi]
    pub fn mark(&mut self, state: Utf16String) -> napi::Result<()> {
        self.search
            .mark(state.to_vec())
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn push(&mut self, state: Utf16String, events: Vec<Utf16String>) -> napi::Result<()> {
        self.search
            .push(
                state.to_vec(),
                events.into_iter().map(|s| s.to_vec()).collect(),
            )
            .map_err(napi::Error::from_reason)
    }
}
#[napi]
pub struct NativeTaskTokenBucket {
    bucket: task_list_rust::migration::TokenBucket,
}
#[napi]
impl NativeTaskTokenBucket {
    #[napi(constructor)]
    pub fn new(rate: f64, now: f64) -> napi::Result<Self> {
        task_list_rust::migration::TokenBucket::new(rate, now)
            .map(|bucket| Self { bucket })
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn take(&mut self, now: f64) -> Option<f64> {
        self.bucket.take(now)
    }
}
