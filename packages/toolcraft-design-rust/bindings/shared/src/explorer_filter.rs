use super::table::NodeHost;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::{explorer_filter, table::Host};

#[napi(object)]
pub struct ExplorerFilterMatch {
    pub score: u32,
    pub positions: Vec<u32>,
}

#[napi]
pub fn design_explorer_match(
    query: Vec<Utf16String>,
    text: Vec<Utf16String>,
) -> Option<ExplorerFilterMatch> {
    explorer_filter::subsequence(
        &query.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
        &text.into_iter().map(|s| s.to_vec()).collect::<Vec<_>>(),
    )
    .map(|value| ExplorerFilterMatch {
        score: value.score,
        positions: value.positions,
    })
}

#[napi]
pub fn design_explorer_project_policy<'env>(
    _operation: String,
    args: Vec<Unknown<'env>>,
    host: Object<'env>,
) -> Result<Vec<u32>> {
    let positions: Vec<u32> = unsafe { args[0].cast()? };
    let mut host = NodeHost { object: host };
    explorer_filter::project(&positions, || {
        let lengths: Vec<u32> = unsafe { host.call("nextLengths", vec![args[1]])?.cast()? };
        Ok::<_, Error>(match lengths.as_slice() {
            [original, folded] => Some((*original, *folded)),
            _ => None,
        })
    })
}
