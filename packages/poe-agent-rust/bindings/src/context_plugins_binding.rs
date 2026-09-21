use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::{
    context_plugins::{self as core, CompactionTail, MemoryLoading},
    transcript::Node,
};
#[napi]
pub fn agent_memory_lines(content: Utf16String) -> Vec<Utf16String> {
    core::normalize_lines(&content)
        .into_iter()
        .map(Into::into)
        .collect()
}
#[napi]
pub fn agent_memory_import(line: Utf16String) -> Option<Utf16String> {
    core::parse_import_path(&line).map(Into::into)
}
#[napi]
#[derive(Default)]
pub struct NativeAgentMemoryLoading {
    state: MemoryLoading,
}
#[napi]
impl NativeAgentMemoryLoading {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn enter(&mut self, path: Utf16String) -> bool {
        self.state.enter(path.to_vec())
    }
    #[napi]
    pub fn leave(&mut self, path: Utf16String) {
        self.state.leave(&path);
    }
}
#[napi]
pub fn format_agent_compaction_summary(env: Env, summary: Unknown<'_>) -> Result<Utf16String> {
    let value = summary.coerce_to_string()?;
    let value = unsafe { Utf16String::from_napi_value(env.raw(), value.raw())? };
    Ok(core::format_compaction_summary(&value).into())
}
#[napi]
pub fn render_agent_compaction_awareness(
    read: Vec<Utf16String>,
    modified: Vec<Utf16String>,
) -> Utf16String {
    core::render_file_awareness(
        read.into_iter().map(|value| value.to_vec()).collect(),
        modified.into_iter().map(|value| value.to_vec()).collect(),
    )
    .into()
}
#[napi]
pub fn plan_agent_compaction<'env>(
    env: Env,
    messages: Object<'env>,
    keep: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let length: u32 = messages.get_named_property("length")?;
    let mut tail_start = length;
    let mut remaining = None;
    for index in (0..length).rev() {
        let message: Unknown<'env> = messages.get_element(index)?;
        if matches!(message.get_type()?, ValueType::Null | ValueType::Undefined) {
            continue;
        }
        let role: Unknown<'env> = message.coerce_to_object()?.get_named_property("role")?;
        if !env.strict_equals(role, env.create_string("user")?)? {
            continue;
        }
        let state = if let Some(state) = remaining.as_mut() {
            state
        } else {
            remaining = Some(CompactionTail::new(keep.coerce_to_number()?.get_double()?));
            remaining.as_mut().expect("initialized tail")
        };
        if state.visit_user() {
            tail_start = index;
            break;
        }
    }
    let mut kept = vec![];
    let mut dropped = vec![];
    let mut index = 0;
    loop {
        let length: u32 = messages.get_named_property("length")?;
        if index >= length {
            break;
        }
        let message: Unknown<'env> = messages.get_element(index)?;
        if message.coerce_to_bool()? {
            let preserve = if index < tail_start {
                let object = message.coerce_to_object()?;
                let role: Unknown<'env> = object.get_named_property("role")?;
                if env.strict_equals(role, env.create_string("system")?)? {
                    let name: Unknown<'env> = object.get_named_property("name")?;
                    !env.strict_equals(name, env.create_string("compaction")?)?
                } else {
                    false
                }
            } else {
                true
            };
            if preserve {
                kept.push(Node::Opaque(message.raw()));
            } else {
                dropped.push(Node::Opaque(message.raw()));
            }
        }
        index += 1;
    }
    if dropped.is_empty() {
        return Ok(unsafe {
            Unknown::from_raw_unchecked(env.raw(), Null::to_napi_value(env.raw(), Null)?)
        });
    }
    let result = super::transcript_binding::encode(
        env,
        Node::Object(vec![
            ("messages", Node::Array(kept)),
            ("droppedMessages", Node::Array(dropped)),
        ]),
    )?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), result) })
}

#[napi]
pub fn map_agent_audit_record<'env>(
    env: Env,
    timestamp: Unknown<'env>,
    context: Object<'env>,
    compaction: bool,
) -> Result<Unknown<'env>> {
    let event = if compaction {
        let summary: Unknown<'env> = context.get_named_property("summary")?;
        let dropped: Unknown<'env> = context.get_named_property("droppedMessages")?;
        let count: Unknown<'env> = dropped.coerce_to_object()?.get_named_property("length")?;
        core::Audit::Compaction {
            summary: summary.raw(),
            dropped_count: count.raw(),
        }
    } else {
        core::Audit::Tool(context.get_named_property::<Unknown<'env>>("tool")?.raw())
    };
    let node = core::audit_record(timestamp.raw(), event);
    let value = super::transcript_binding::encode(env, node)?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), value) })
}

#[napi]
pub fn agent_git_context(parts: Vec<Utf16String>) -> Result<Utf16String> {
    core::git_context(
        &parts
            .into_iter()
            .map(|part| part.to_vec())
            .collect::<Vec<_>>(),
    )
    .map(Into::into)
    .map_err(napi::Error::from_reason)
}
