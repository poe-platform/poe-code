//! One addon owns queue state and embeds the declarative agent catalog.
#[path = "../../../agent-defs-rust/bindings/src/lib.rs"]
mod catalog;
use agent_harness_tools_rust::queue::{Item, Queue, Status};
pub use catalog::*;
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (u(key), value))
            .collect(),
    )
}
fn string(s: &str) -> Value {
    Value::String(u(s))
}
fn item(item: &Item) -> Value {
    let mut fields = vec![
        ("id", Value::String(item.id.clone())),
        ("kind", string(if item.plan { "plan" } else { "message" })),
        ("status", string(item.status.name())),
        (
            if item.plan { "path" } else { "text" },
            Value::String(item.text.clone()),
        ),
    ];
    if let Some(id) = &item.after_plan {
        fields.push(("afterPlanId", Value::String(id.clone())));
    }
    object(fields)
}
fn error(message: Vec<u16>) -> NativeJson {
    NativeJson(object(vec![("error", Value::String(message))]))
}
fn update(fields: Vec<(&str, Value)>) -> NativeJson {
    NativeJson(object(vec![("update", object(fields))]))
}
#[napi]
#[derive(Default)]
pub struct NativeHarnessQueue {
    core: Queue,
}
#[napi]
impl NativeHarnessQueue {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi(getter)]
    pub fn has_work(&self) -> bool {
        self.core.has_work()
    }
    #[napi(getter)]
    pub fn items(&self) -> NativeJson {
        NativeJson(Value::Array(self.core.items().iter().map(item).collect()))
    }
    #[napi]
    pub fn assert_accepting(&self) -> NativeJson {
        match self.core.assert_accepting() {
            Ok(()) => update(vec![]),
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn enqueue_plan(
        &mut self,
        path: Utf16String,
        absolute: Utf16String,
        messages: Vec<Utf16String>,
    ) -> NativeJson {
        match self.core.enqueue_plan(
            path.to_vec(),
            absolute.to_vec(),
            messages.into_iter().map(|text| text.to_vec()).collect(),
        ) {
            Ok(id) => NativeJson(object(vec![
                ("value", Value::String(id)),
                ("itemsChanged", Value::Bool(true)),
                ("update", object(vec![])),
            ])),
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn enqueue_message(
        &mut self,
        text: Utf16String,
        target: Option<Utf16String>,
    ) -> NativeJson {
        match self
            .core
            .enqueue_message(text.to_vec(), target.map(|value| value.to_vec()))
        {
            Ok(id) => NativeJson(object(vec![
                ("value", Value::String(id)),
                ("itemsChanged", Value::Bool(true)),
                ("update", object(vec![])),
            ])),
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn begin(&mut self) -> NativeJson {
        match self.core.begin() {
            Ok(()) => update(vec![("status", string("running"))]),
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn activate(&mut self) -> NativeJson {
        match self.core.activate() {
            Ok(active) => NativeJson(object(vec![
                ("active", item(&active)),
                ("itemsChanged", Value::Bool(true)),
                (
                    "update",
                    object(vec![
                        (
                            "activePlanId",
                            Value::String(self.core.active_plan.clone().unwrap()),
                        ),
                        ("activeItemId", Value::String(active.id)),
                    ]),
                ),
            ])),
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn finish(&mut self, outcome: String) -> NativeJson {
        let Some(outcome) = Status::outcome(&outcome) else {
            return error(u("Invalid harness queue outcome."));
        };
        match self.core.finish(outcome) {
            Ok(()) => {
                let mut fields = vec![("activeItemId", Value::Null)];
                if outcome != Status::Completed {
                    fields.push(("status", string(outcome.name())));
                }
                NativeJson(object(vec![
                    ("itemsChanged", Value::Bool(true)),
                    ("update", object(fields)),
                ]))
            }
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn advance(&mut self) -> NativeJson {
        match self.core.advance() {
            Ok(()) => update(vec![]),
            Err(message) => error(message),
        }
    }
    #[napi]
    pub fn stop(&mut self, outcome: String) -> NativeJson {
        let Some(outcome) = Status::outcome(&outcome) else {
            return error(u("Invalid harness queue outcome."));
        };
        self.core.stop(outcome);
        update(vec![
            ("status", string(outcome.name())),
            ("activeItemId", Value::Null),
        ])
    }
}

#[napi]
pub fn harness_path_contained(relative: Utf16String, absolute: bool, separator: u32) -> bool {
    agent_harness_tools_rust::paths::contained(&relative, absolute, separator as u16)
}
#[napi]
pub fn harness_default_glob(subdirectory: Utf16String) -> Utf16String {
    agent_harness_tools_rust::paths::default_glob(&subdirectory).into()
}
#[napi]
pub fn harness_matches_glob(
    name: Utf16String,
    lower_name: Utf16String,
    glob: Utf16String,
    lower_glob: Utf16String,
) -> bool {
    agent_harness_tools_rust::paths::matches_glob(&name, &lower_name, &glob, &lower_glob)
}
#[napi]
pub fn harness_merge_docs(
    global_names: Vec<Utf16String>,
    global_paths: Vec<Utf16String>,
    project_names: Vec<Utf16String>,
    project_paths: Vec<Utf16String>,
) -> Vec<Utf16String> {
    let global = global_names
        .into_iter()
        .zip(global_paths)
        .map(|(name, path)| (name.to_vec(), path.to_vec()))
        .collect();
    let project = project_names
        .into_iter()
        .zip(project_paths)
        .map(|(name, path)| (name.to_vec(), path.to_vec()))
        .collect();
    agent_harness_tools_rust::paths::merge_docs(global, project)
        .into_iter()
        .map(Utf16String::from)
        .collect()
}
#[napi]
pub fn harness_plan_slug(base: Utf16String, digest: Utf16String) -> Utf16String {
    agent_harness_tools_rust::logs::plan_slug(&base, &digest).into()
}
#[napi]
pub fn harness_log_filename(
    role: Utf16String,
    date: Vec<Utf16String>,
) -> napi::Result<Utf16String> {
    let date: [Vec<u16>; 7] = date
        .into_iter()
        .map(|value| value.to_vec())
        .collect::<Vec<_>>()
        .try_into()
        .map_err(|_| napi::Error::from_reason("Run log filename requires seven UTC components"))?;
    Ok(agent_harness_tools_rust::logs::file_name(&role, &date).into())
}
#[path = "../../../task-list-rust/bindings/src/lib.rs"]
mod tasks;
pub use tasks::*;
#[napi]
pub fn harness_plan_file_id(filename: Utf16String) -> Option<Utf16String> {
    agent_harness_tools_rust::plans::file_id(&filename).map(Utf16String::from)
}
#[napi]
pub fn harness_plan_readiness(value: Option<Utf16String>) -> Option<Utf16String> {
    agent_harness_tools_rust::plans::readiness(value.as_deref()).map(Utf16String::from)
}
#[napi]
pub fn harness_readiness_label(label: Utf16String, ready: bool) -> Utf16String {
    agent_harness_tools_rust::plans::readiness_label(&label, ready).into()
}
#[napi]
pub fn harness_compare_readiness(left: bool, right: bool) -> i32 {
    agent_harness_tools_rust::plans::compare_readiness(left, right)
}
#[napi]
pub fn harness_queue_summary(
    completed_plans: u32,
    plans: u32,
    completed_messages: u32,
    messages: u32,
    pending: u32,
) -> Utf16String {
    agent_harness_tools_rust::plans::queue_summary(
        completed_plans,
        plans,
        completed_messages,
        messages,
        pending,
    )
    .into()
}
