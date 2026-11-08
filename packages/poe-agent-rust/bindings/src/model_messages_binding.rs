use napi::{Env, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use poe_agent_rust::{
    model_messages::{self, CopyKind, MessageHost},
    transcript::Node,
};
struct Host<'env> {
    env: Env,
    object: Object<'env>,
    effects: Object<'env>,
}
impl MessageHost<napi::sys::napi_value, napi::Error> for Host<'_> {
    fn field(&mut self, key: &'static str) -> Result<napi::sys::napi_value> {
        Ok(self.object.get_named_property::<Unknown<'_>>(key)?.raw())
    }
    fn undefined(&self, value: &napi::sys::napi_value) -> Result<bool> {
        Ok(
            unsafe { Unknown::from_raw_unchecked(self.env.raw(), *value) }.get_type()?
                == ValueType::Undefined,
        )
    }
    fn tool_role(&self, value: &napi::sys::napi_value) -> Result<bool> {
        self.env.strict_equals(
            unsafe { Unknown::from_raw_unchecked(self.env.raw(), *value) },
            self.env.create_string("tool")?,
        )
    }
    fn copy(
        &mut self,
        kind: CopyKind,
        value: napi::sys::napi_value,
    ) -> Result<napi::sys::napi_value> {
        let function: Unknown<'_> = self.effects.get_named_property(match kind {
            CopyKind::Entries => "entries",
            CopyKind::Values => "values",
        })?;
        let receiver = unsafe { Undefined::to_napi_value(self.env.raw(), ())? };
        let mut result = std::ptr::null_mut();
        let status = unsafe {
            napi::sys::napi_call_function(
                self.env.raw(),
                receiver,
                function.raw(),
                1,
                &value,
                &mut result,
            )
        };
        if status == napi::sys::Status::napi_ok {
            Ok(result)
        } else {
            Err(napi::Error::new(
                napi::Status::from(status),
                "Model message copy failed",
            ))
        }
    }
}
#[napi]
pub fn map_agent_request_message<'env>(
    env: Env,
    message: Object<'env>,
    effects: Object<'env>,
) -> Result<Unknown<'env>> {
    let mut host = Host {
        env,
        object: message,
        effects,
    };
    let (message, tool) = model_messages::request_message(&mut host)?;
    let node = Node::Object(vec![("message", message), ("toolRole", Node::Bool(tool))]);
    let result = super::transcript_binding::encode(env, node)?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), result) })
}
#[napi]
pub fn map_agent_assistant_message<'env>(
    env: Env,
    response: Object<'env>,
    effects: Object<'env>,
) -> Result<Unknown<'env>> {
    let mut host = Host {
        env,
        object: response,
        effects,
    };
    let node = model_messages::assistant_message(&mut host)?;
    let result = super::transcript_binding::encode(env, node)?;
    Ok(unsafe { Unknown::from_raw_unchecked(env.raw(), result) })
}
