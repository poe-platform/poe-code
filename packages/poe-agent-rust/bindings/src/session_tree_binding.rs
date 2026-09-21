use napi::bindgen_prelude::*;
use napi_derive::napi;
use poe_agent_rust::session_tree::{self, Branch};
#[napi]
pub fn session_collect_branch(
    entries: Vec<Object<'_>>,
    names: Vec<Utf16String>,
    head: Unknown<'_>,
) -> Result<Vec<u32>> {
    if head.get_type()? != napi::ValueType::String {
        return Ok(vec![]);
    }
    let mut current: Utf16String = unsafe { head.cast()? };
    let mut branch = Branch::borrowed(names.iter().map(|name| &name[..]));
    let mut indices = vec![];
    while let Some(index) = branch.find(&current).map_err(napi::Error::from_reason)? {
        let entry = entries.get(index).ok_or_else(|| {
            napi::Error::from_reason("Session branch input lengths do not match.")
        })?;
        indices.push(index as u32);
        let parent: Unknown<'_> = entry.get_c_named_property_unchecked(c"parentId")?;
        if parent.get_type()? != napi::ValueType::String {
            break;
        }
        current = unsafe { parent.cast()? };
    }
    indices.reverse();
    Ok(indices)
}
#[napi]
pub fn session_entry_kind(env: Env, entry: Object<'_>) -> Result<u32> {
    session_tree::classify(|label| {
        let value: Unknown<'_> = entry.get_c_named_property_unchecked(c"kind")?;
        env.strict_equals(value, env.create_string(label)?)
    })
    .map(|kind| kind as u32)
}
