use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::code_highlight;

#[napi(object)]
pub struct DesignCodeToken {
    pub kind: String,
    pub value: Utf16String,
}
#[napi]
pub fn design_code_language_known(alias: String) -> bool {
    code_highlight::language_known(&alias)
}
#[napi]
pub fn design_highlight_code(source: Utf16String, alias: String) -> Vec<DesignCodeToken> {
    code_highlight::highlight(&source, &alias)
        .into_iter()
        .map(|token| DesignCodeToken {
            kind: token.kind.to_owned(),
            value: source[token.start..token.end].to_vec().into(),
        })
        .collect()
}
