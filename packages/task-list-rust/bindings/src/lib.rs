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
