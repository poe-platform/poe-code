use napi::{ValueType, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::{
    model_stream::{Collector, ToolCall},
    transcript::Node,
};
use std::cell::RefCell;
type ArenaCollector = Collector<u32>;

fn call_emitter(
    env: Env,
    receiver: napi::sys::napi_value,
    callback: napi::sys::napi_value,
    event: napi::sys::napi_value,
) -> Result<()> {
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        napi::sys::napi_call_function(env.raw(), receiver, callback, 1, &event, &mut result)
    };
    if status == napi::sys::Status::napi_ok {
        Ok(())
    } else {
        Err(napi::Error::new(
            napi::Status::from(status),
            "Model emitter failed",
        ))
    }
}

#[napi]
#[derive(Default)]
pub struct NativeAgentModelCollector {
    state: RefCell<ArenaCollector>,
}
#[napi]
impl NativeAgentModelCollector {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn consume<'env>(
        &self,
        env: Env,
        event: Object<'env>,
        arena: Object<'env>,
        options: Object<'env>,
    ) -> Result<()> {
        let roots: Object<'env> = arena.get_c_named_property_unchecked(c"roots")?;
        let store: Function<'env, Unknown<'env>, u32> =
            arena.get_c_named_property_unchecked(c"store")?;
        let parse: Function<'env, Utf16String, Option<u32>> =
            arena.get_c_named_property_unchecked(c"parse")?;
        let retire: Function<'env, u32, Undefined> =
            arena.get_c_named_property_unchecked(c"retire")?;
        let emitter = || {
            options
                .get_c_named_property_unchecked::<Option<Function<'env, Unknown<'env>, Undefined>>>(
                    c"emit",
                )
        };
        let field = |name| event.get_c_named_property_unchecked::<Unknown<'env>>(name);
        let string = |name| event.get_c_named_property_unchecked::<Utf16String>(name);
        let kind = field(c"type")?;
        if kind.get_type()? != ValueType::String {
            return Ok(());
        }
        let kind: String = unsafe { kind.cast()? };
        match kind.as_str() {
            "text" => {
                if string(c"text")?.is_empty() {
                    return Ok(());
                }
                self.state.borrow_mut().append_text(&string(c"text")?);
                if let Some(emit) = emitter()? {
                    let content = field(c"text")?.raw();
                    let node = Node::Object(vec![
                        ("type", Node::String("message.delta")),
                        ("content", Node::Opaque(content)),
                    ]);
                    let value = super::transcript_binding::encode(env, node)?;
                    call_emitter(env, options.raw(), emit.raw(), value)?;
                }
            }
            "thinking" => {
                if string(c"text")?.is_empty() {
                    return Ok(());
                }
                let last = self.state.borrow().last_signature().cloned();
                let matched = if let Some(last) = last {
                    let signature = field(c"signature")?;
                    match last {
                        None => signature.get_type()? == ValueType::Undefined,
                        Some(last) => {
                            signature.get_type()? == ValueType::String
                                && unsafe { signature.cast::<Utf16String>()? }.as_ref()
                                    == last.as_slice()
                        }
                    }
                } else {
                    false
                };
                if matched {
                    self.state.borrow_mut().merge_thinking(&string(c"text")?);
                } else {
                    let text = string(c"text")?.to_vec();
                    let signature = if field(c"signature")?.get_type()? == ValueType::Undefined {
                        None
                    } else {
                        Some(string(c"signature")?.to_vec())
                    };
                    self.state.borrow_mut().append_thinking(text, signature);
                }
            }
            "redacted_thinking" => {
                let data = store.call(field(c"data")?)?;
                self.state.borrow_mut().redacted(data);
            }
            "reasoning_details" => {
                let payload = store.call(field(c"payload")?)?;
                self.state.borrow_mut().reasoning_detail(payload);
            }
            "tool_use_delta" => {
                let id = string(c"id")?.to_vec();
                self.state.borrow_mut().ensure_pending(&id);
                if field(c"name")?.get_type()? != ValueType::Undefined {
                    let name = field(c"name")?;
                    let name = if name.get_type()? == ValueType::String {
                        Some(unsafe { name.cast::<Utf16String>()? }.to_vec())
                    } else {
                        None
                    };
                    self.state.borrow_mut().set_name(&id, name.as_deref());
                }
                if field(c"argsDelta")?.get_type()? != ValueType::Undefined
                    && !string(c"argsDelta")?.is_empty()
                {
                    self.state
                        .borrow_mut()
                        .append_delta(&id, &string(c"argsDelta")?);
                }
                if let Some(emit) = emitter()? {
                    let intent = self.state.borrow().pending_intent(&id);
                    if let Some(intent) = intent
                        && let Some(args) = parse.call(intent.arguments.into())?
                    {
                        let handle = args;
                        let args: Unknown<'env> = roots.get_element(handle)?;
                        let node = Node::Object(vec![
                            ("type", Node::String("tool.intent")),
                            ("intentId", Node::Utf16(intent.intent_id)),
                            ("tool", Node::Utf16(intent.tool)),
                            ("args", Node::Opaque(args.raw())),
                        ]);
                        let value = super::transcript_binding::encode(env, node)?;
                        let receiver = unsafe { Undefined::to_napi_value(env.raw(), ())? };
                        let result = call_emitter(env, receiver, emit.raw(), value);
                        if result.is_ok() {
                            retire.call(handle)?;
                        }
                        result?;
                        self.state.borrow_mut().mark_emitted(&id);
                    }
                }
            }
            "tool_use_complete" => {
                let id = string(c"id")?.to_vec();
                self.state.borrow_mut().ensure_pending(&id);
                let name = field(c"name")?;
                let name = if name.get_type()? == ValueType::String {
                    Some(unsafe { name.cast::<Utf16String>()? }.to_vec())
                } else {
                    None
                };
                let tool = name
                    .as_deref()
                    .map(mcp_protocol_rust::strings::trim_ecmascript)
                    .filter(|value| !value.is_empty())
                    .map(<[u16]>::to_vec);
                let Some(tool) = tool else {
                    self.state.borrow_mut().remove(&string(c"id")?);
                    return Ok(());
                };
                let intent_id = string(c"id")?.to_vec();
                let args = store.call(field(c"args")?)?;
                let raw_arguments = if self.state.borrow().has_arguments(&id) {
                    None
                } else if field(c"args")?.get_type()? == ValueType::String {
                    Some(string(c"args")?.to_vec())
                } else {
                    None
                };
                let retire_id = string(c"id")?.to_vec();
                self.state.borrow_mut().complete(
                    &id,
                    ToolCall {
                        intent_id,
                        tool,
                        args,
                        raw_arguments,
                        intent_emitted: false,
                    },
                    &retire_id,
                );
            }
            "tool_use_json_parse_error" => {
                let id = string(c"id")?.to_vec();
                self.state.borrow_mut().ensure_pending(&id);
                let intent_id = string(c"id")?.to_vec();
                let args = store.call(field(c"raw")?)?;
                let error = store.call(field(c"error")?)?;
                let retire_id = string(c"id")?.to_vec();
                self.state
                    .borrow_mut()
                    .parse_error(&id, intent_id, args, error, &retire_id);
            }
            "usage" => {
                let usage = [
                    store.call(field(c"inputTokens")?)?,
                    store.call(field(c"outputTokens")?)?,
                    store.call(field(c"cachedTokens")?)?,
                    store.call(field(c"cacheCreationTokens")?)?,
                ];
                let previous = self.state.borrow_mut().usage(usage);
                if let Some(previous) = previous {
                    for handle in previous {
                        retire.call(handle)?;
                    }
                }
            }
            "stop" => {
                let reason = field(c"reason")?;
                let reason = if reason.get_type()? == ValueType::Undefined {
                    None
                } else {
                    Some(store.call(reason)?)
                };
                let previous = self.state.borrow_mut().stop(reason);
                if let Some(previous) = previous {
                    retire.call(previous)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    #[napi]
    pub fn finish<'env>(&self, env: Env, roots: Object<'env>) -> Result<Unknown<'env>> {
        let collector = std::mem::take(&mut *self.state.borrow_mut());
        let template = collector.finish().template().try_map(&mut |handle| {
            roots
                .get_element::<Unknown<'env>>(handle)
                .map(|value| value.raw())
        })?;
        let value = super::transcript_binding::encode(env, template)?;
        Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), value) })
    }
}
