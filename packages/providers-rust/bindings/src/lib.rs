use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::{Error, bindgen_prelude::*};
use napi_derive::napi;
#[napi]
#[derive(Default)]
pub struct NativeProviderIdentity {
    state: providers_rust::Registry,
}
#[napi]
impl NativeProviderIdentity {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[napi]
    pub fn get(&self, id: Utf16String) -> Option<u32> {
        self.state.get(&id).map(|i| i as u32)
    }
    #[napi]
    pub fn has(&self, id: Utf16String) -> bool {
        self.state.get(&id).is_some()
    }
    #[napi]
    pub fn insert(&mut self, id: Utf16String) -> Result<u32> {
        if let Some(index) = self.state.get(&id) {
            return Ok(index as u32);
        }
        self.state
            .insert(id.to_vec(), None)
            .map(|i| i as u32)
            .map_err(|_| Error::from_reason("Duplicate provider registry identity"))
    }
}
#[napi]
pub fn provider_trim(value: Utf16String) -> Utf16String {
    providers_rust::trim(&value).to_vec().into()
}
#[napi]
pub fn provider_rank(api_key: bool, oauth: bool, url: bool) -> u32 {
    providers_rust::rank(api_key, oauth, url)
}
#[napi]
pub fn provider_resolve_shape(provider: Vec<Utf16String>, agent: Vec<Utf16String>) -> Option<u32> {
    providers_rust::resolve_shape(
        &provider.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
        &agent.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
    )
    .map(|i| i as u32)
}
#[napi]
pub fn provider_catalog() -> Result<NativeJson> {
    providers_rust::catalog()
        .map(|values| NativeJson(Value::Array(values)))
        .map_err(Error::from_reason)
}

#[napi]
pub fn provider_resolve_live<'env>(
    env: Env,
    next: Function<'env, (), Object<'env>>,
    matches: Function<'env, Unknown<'env>, bool>,
) -> Result<Object<'env>> {
    let mut result = Object::new(&env)?;
    let value = providers_rust::first_match(
        || {
            env.run_in_scope(|| {
                let step = next.call(())?;
                let done: Unknown<'env> = step.get_c_named_property_unchecked(c"done")?;
                if done.coerce_to_bool()? {
                    return Ok(None);
                }
                let candidate: Unknown<'env> = step.get_c_named_property_unchecked(c"value")?;
                let matched = matches
                    .call(unsafe { Unknown::from_raw_unchecked(env.raw(), candidate.raw()) })?;
                if matched {
                    result.set_named_property("value", candidate)?;
                }
                // Only a scalar leaves this scope; matched payloads are rooted in the outer result.
                Ok(Some(matched))
            })
        },
        |matched| Ok(*matched),
    )?;
    result.set_named_property("found", value.is_some())?;
    Ok(result)
}
