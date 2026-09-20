use agent_skill_config_rust::{
    Catalog, SupportStatus,
    paths::{self, PathPlan, Scope},
    resolve::{self, Host, Resolution, StatError},
};
use std::collections::HashSet;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn catalog_derives_aliases_skill_descriptors_and_home_plans() {
    let catalog = Catalog::builtins().unwrap();
    assert_eq!(
        catalog.supported_agents(),
        [
            "claude-code",
            "codex",
            "cursor",
            "gemini-cli",
            "opencode",
            "goose"
        ]
        .map(u)
    );
    assert_eq!(catalog.resolve(&u(" CLAUDE ")).id, Some(u("claude-code")));
    assert_eq!(
        catalog.resolve(&u("poe-agent")).status,
        SupportStatus::Unsupported
    );
    assert_eq!(
        catalog.resolve(&u("constructor")).status,
        SupportStatus::Unknown
    );
    let config = catalog.resolve(&u("claude")).config.unwrap();
    assert_eq!(
        paths::plan_skill_dir(config, Scope::Global, &u("/repo"), &u("/home")),
        PathPlan::Join {
            directory: u("/home"),
            path: u(".claude/skills")
        }
    );
    assert_eq!(
        paths::plan_skill_dir(config, Scope::Local, &u("/repo"), &u("/home")),
        PathPlan::From {
            directory: u("/repo"),
            path: u(".claude/skills")
        }
    );
}
#[derive(Default)]
struct Memory {
    directories: HashSet<Vec<u16>>,
    calls: Vec<Vec<u16>>,
    denied: bool,
}
impl Host for Memory {
    type Error = &'static str;
    fn resolve(&mut self, parts: &[&[u16]]) -> Result<Vec<u16>, Self::Error> {
        Ok(u(&parts
            .iter()
            .map(|part| String::from_utf16_lossy(part))
            .collect::<Vec<_>>()
            .join("/")))
    }
    fn join(&mut self, directory: &[u16], path: &[u16]) -> Result<Vec<u16>, Self::Error> {
        self.resolve(&[directory, path])
    }
    fn is_directory(&mut self, path: &[u16]) -> Result<bool, StatError<Self::Error>> {
        self.calls.push(path.to_vec());
        if self.denied {
            Err(StatError::Other("denied"))
        } else {
            Ok(self.directories.contains(path))
        }
    }
}
#[test]
fn reference_resolution_preserves_search_order_case_and_original_foreign_errors() {
    let catalog = Catalog::builtins().unwrap();
    let mut host = Memory::default();
    host.directories.insert(u("/repo/.claude/skills/foo"));
    let result = resolve::resolve_skill_reference(
        &catalog,
        &u("CLAUDE/foo"),
        &u("/repo"),
        &u("/home"),
        &mut host,
    )
    .unwrap();
    assert!(
        matches!(result,Resolution::Resolved{source_agent_id:Some(id),scope:Scope::Local,..}if id==u("claude-code"))
    );
    assert_eq!(host.calls, [u("/repo/.claude/skills/foo")]);
    for reference in ["", ".", "..", "foo/", "claude/..", " a", "a/b/c", "a\n"] {
        assert!(matches!(
            resolve::resolve_skill_reference(
                &catalog,
                &u(reference),
                &u("/repo"),
                &u("/home"),
                &mut host
            )
            .unwrap(),
            Resolution::Malformed { .. }
        ));
    }
    assert!(matches!(
        resolve::resolve_skill_reference(
            &catalog,
            &u("unknown/foo"),
            &u("/repo"),
            &u("/home"),
            &mut host
        )
        .unwrap(),
        Resolution::UnknownAgent { .. }
    ));
    host.denied = true;
    assert_eq!(
        resolve::resolve_skill_reference(&catalog, &u("foo"), &u("/repo"), &u("/home"), &mut host),
        Err("denied")
    );
}
