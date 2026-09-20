use agent_hook_config_rust::{
    Catalog,
    paths::{PathPlan, Scope, plan_hook_path},
};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn path_planning_owns_home_expansion_and_scope_without_platform_io() {
    let catalog = Catalog::builtins().unwrap();
    let mut config = catalog
        .resolve_normalized(&u("codex"))
        .config
        .unwrap()
        .clone();
    for (global, remainder) in [
        ("~/.codex/hooks.json", ".codex/hooks.json"),
        ("~./codex/hooks.json", ".codex/hooks.json"),
        ("~.codex/hooks.json", "codex/hooks.json"),
        ("~\\codex/hooks.json", "codex/hooks.json"),
    ] {
        config.global_path = u(global);
        assert_eq!(
            plan_hook_path(&config, Scope::Global, &u("/repo"), &u("/home")),
            Some(PathPlan::Join {
                directory: u("/home"),
                path: u(remainder)
            })
        );
    }
    config.global_path = u("~");
    assert_eq!(
        plan_hook_path(&config, Scope::Global, &u("/repo"), &u("/home")),
        Some(PathPlan::Resolve(u("/home")))
    );
    config.global_path = u("relative.json");
    assert_eq!(
        plan_hook_path(&config, Scope::Global, &u("/repo"), &u("/home")),
        Some(PathPlan::Resolve(u("relative.json")))
    );
    assert_eq!(
        plan_hook_path(&config, Scope::Local, &u("/repo"), &u("/home")),
        Some(PathPlan::ResolveFrom {
            directory: u("/repo"),
            path: u(".codex/hooks.json")
        })
    );
    config.local_path = Some(vec![]);
    assert_eq!(
        plan_hook_path(&config, Scope::Local, &u("/repo"), &u("/home")),
        None
    );
}
