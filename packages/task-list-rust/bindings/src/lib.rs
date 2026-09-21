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
