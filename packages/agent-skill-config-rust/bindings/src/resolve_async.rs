use super::*;
use agent_skill_config_rust::resolve::Plan;

#[napi]
pub fn skill_resolve_plan(
    reference: Utf16String,
    cwd: Utf16String,
    home: Utf16String,
    callback: Callback,
) -> Result<NativeJson> {
    let plan = match resolve::plan_skill_reference(
        catalog(),
        &reference,
        &cwd,
        &home,
        &mut Host {
            callback,
            bytes: None,
        },
    ) {
        Ok(plan) => plan,
        Err(error) => return host_error(error),
    };
    Ok(NativeJson(match plan {
        Plan::Terminal(result) => object(vec![("result", resolution(result))]),
        Plan::Search(search) => object(vec![
            (
                "candidates",
                J::Array(
                    search
                        .tiers
                        .iter()
                        .enumerate()
                        .map(|(index, (_, path))| {
                            object(vec![
                                ("path", J::String(path.clone())),
                                ("result", resolution(search.found(index))),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("missing", resolution(search.missing())),
        ]),
    }))
}
