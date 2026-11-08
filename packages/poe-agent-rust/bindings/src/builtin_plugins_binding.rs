use mcp_protocol_rust::strings::trim_ecmascript;
use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::builtin_plugins::{
    self as core, ArgumentKind, Scratchpad, SkillCatalog, StringSet,
};
#[napi]
#[derive(Default)]
pub struct NativeAgentScratchpad {
    state: Scratchpad,
}
#[napi]
impl NativeAgentScratchpad {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn write(&mut self, key: Utf16String, value: Utf16String) {
        self.state.write(key.to_vec(), value.to_vec());
    }
    #[napi]
    pub fn read(&self, key: Utf16String) -> Option<Utf16String> {
        self.state.read(&key).map(|value| value.to_vec().into())
    }
}
#[napi]
#[derive(Default)]
pub struct NativeAgentStringSet {
    state: StringSet,
}
#[napi]
impl NativeAgentStringSet {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn admit(&mut self, value: Utf16String) -> bool {
        self.state.admit(value.to_vec())
    }
}
#[napi]
#[derive(Default)]
pub struct NativeAgentSkillCatalog {
    state: SkillCatalog,
}
#[napi]
impl NativeAgentSkillCatalog {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn contains(&self, name: Utf16String) -> bool {
        self.state.contains(&name)
    }
    #[napi]
    pub fn insert(&mut self, name: Utf16String, tools: Vec<Utf16String>, tags: Vec<Utf16String>) {
        self.state.insert(
            name.to_vec(),
            tools.into_iter().map(|value| value.to_vec()).collect(),
            tags.into_iter().map(|value| value.to_vec()).collect(),
        );
    }
    #[napi]
    pub fn guidance<'env>(
        &self,
        env: Env,
        active: Vec<Utf16String>,
        available: Unknown<'env>,
    ) -> Result<Option<Utf16String>> {
        let active = active
            .into_iter()
            .map(|value| value.to_vec())
            .collect::<Vec<_>>();
        let Some(lines) = self.state.guidance_lines(&active) else {
            return Ok(None);
        };
        let receiver = unsafe { Undefined::to_napi_value(env.raw(), ())? };
        let mut result = std::ptr::null_mut();
        let status = unsafe {
            napi::sys::napi_call_function(
                env.raw(),
                receiver,
                available.raw(),
                0,
                std::ptr::null(),
                &mut result,
            )
        };
        if status != napi::sys::Status::napi_ok {
            return Err(napi::Error::new(
                napi::Status::from(status),
                "Skill tools formatting failed",
            ));
        }
        let value = unsafe { Unknown::from_raw_unchecked(env.raw(), result) };
        let available = if value.get_type()? == ValueType::Null {
            None
        } else {
            Some(unsafe { Utf16String::from_napi_value(env.raw(), result)? }.to_vec())
        };
        Ok(Some(core::finish_guidance(lines, available).into()))
    }
}
#[napi]
pub fn validate_agent_argument(
    value: Unknown<'_>,
    key: Utf16String,
    kind: String,
    optional: bool,
    allow_empty: bool,
) -> Result<Option<Utf16String>> {
    let value_type = value.get_type()?;
    if optional && value_type == ValueType::Undefined {
        return Ok(None);
    }
    let kind = match kind.as_str() {
        "string" if allow_empty => ArgumentKind::OptionalString,
        "string" => ArgumentKind::RequiredString,
        "boolean" => ArgumentKind::Boolean,
        "number" => ArgumentKind::Number,
        "integer" => ArgumentKind::NonNegativeInteger,
        _ => return Err(napi::Error::from_reason("Unknown agent argument kind")),
    };
    let matches = match kind {
        ArgumentKind::RequiredString | ArgumentKind::OptionalString => {
            value_type == ValueType::String
        }
        ArgumentKind::Boolean => value_type == ValueType::Boolean,
        ArgumentKind::Number | ArgumentKind::NonNegativeInteger => value_type == ValueType::Number,
    };
    let number = if matches && value_type == ValueType::Number {
        Some(value.coerce_to_number()?.get_double()?)
    } else {
        None
    };
    let empty = matches!(kind, ArgumentKind::RequiredString)
        && matches
        && value_type == ValueType::String
        && trim_ecmascript(&unsafe { value.cast::<Utf16String>()? }).is_empty();
    Ok(core::argument_failure(kind, matches, number, empty)
        .map(|failure| core::argument_message(&key, failure).into()))
}
#[napi]
pub fn agent_policy_failure(tool: Utf16String, mode: Utf16String, missing: bool) -> Utf16String {
    core::policy_failure(&tool, &mode, missing).into()
}
#[napi]
pub fn agent_policy_permissive(env: Env, mode: Unknown<'_>) -> Result<bool> {
    Ok(mode.get_type()? == ValueType::Undefined
        || env.strict_equals(mode, env.create_string("yolo")?)?)
}
#[napi]
pub fn agent_iteration_exceeded(iteration: f64, limit: f64) -> bool {
    core::iteration_exceeded(iteration, limit)
}
