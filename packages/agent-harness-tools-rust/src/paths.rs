//! Workflow discovery policy over platform-normalized UTF-16 paths.
use std::collections::BTreeMap;
pub fn contained(relative: &[u16], absolute: bool, separator: u16) -> bool {
    !absolute && relative != [46, 46] && !relative.starts_with(&[46, 46, separator])
}
pub fn default_glob(subdirectory: &[u16]) -> Vec<u16> {
    if subdirectory.starts_with(&"pipeline/".encode_utf16().collect::<Vec<_>>()) {
        "*.yaml"
    } else {
        "*.md"
    }
    .encode_utf16()
    .collect()
}
/// Host supplies Unicode lowercase strings to retain ECMAScript casing semantics.
pub fn matches_glob(name: &[u16], lower_name: &[u16], glob: &[u16], lower_glob: &[u16]) -> bool {
    if glob == [42] {
        true
    } else if glob.starts_with(&[42, 46]) {
        lower_glob
            .get(1..)
            .is_some_and(|suffix| lower_name.ends_with(suffix))
    } else {
        name == glob
    }
}
pub fn merge_docs(
    global: Vec<(Vec<u16>, Vec<u16>)>,
    project: Vec<(Vec<u16>, Vec<u16>)>,
) -> Vec<Vec<u16>> {
    let mut positions = BTreeMap::new();
    let mut paths = Vec::new();
    for (name, path) in global.into_iter().chain(project) {
        if let Some(index) = positions.get(&name) {
            paths[*index] = path;
        } else {
            positions.insert(name, paths.len());
            paths.push(path);
        }
    }
    paths
}
