use agent_skill_config_rust::{
    Catalog,
    apply::{Machine, Operation, Options, Request, Response},
    templates,
};
use mcp_protocol_rust::json::Value;
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn options(scope: Option<bool>, force: bool) -> Options {
    Options {
        cwd: u("/repo"),
        home: u("/home"),
        global: scope,
        force,
    }
}
fn machine(operation: Operation, scope: Option<bool>, force: bool) -> Machine {
    Machine::new(
        &Catalog::builtins().unwrap(),
        &u("claude"),
        operation,
        options(scope, force),
    )
    .unwrap()
}
fn field(value: &Value, key: &str, text: &str) {
    assert_eq!(value.get(key), Some(&Value::String(u(text))));
}
#[test]
fn configure_preflight_admits_only_matching_bundles_and_uses_global_default() {
    let mut m = machine(Operation::Configure, None, false);
    assert_eq!(
        m.start().unwrap(),
        Request::Stat(u("/home/.claude/skills/poe-generate.md"))
    );
    assert_eq!(
        m.respond(Response::Exists(true)).unwrap(),
        Request::Read(u("/home/.claude/skills/poe-generate.md"))
    );
    assert_eq!(
        m.respond(Response::Content(u("user skill"))).unwrap(),
        Request::Template(u("poe-generate.md"))
    );
    let error = m
        .respond(Response::Template(u("bundled skill")))
        .unwrap_err();
    assert!(error.user);
    assert!(String::from_utf16_lossy(&error.message).contains("Move or delete"));
    let mut m = machine(Operation::Configure, Some(false), false);
    m.start().unwrap();
    let Request::Done(plan) = m.respond(Response::Exists(false)).unwrap() else {
        panic!("expected mutations")
    };
    assert_eq!(plan.home, u("/repo"));
    assert_eq!(plan.mutations.len(), 2);
    field(&plan.mutations[0], "path", "~/.claude/skills");
    field(
        &plan.mutations[1],
        "target",
        "~/.claude/skills/poe-generate.md",
    );
    field(
        &plan.mutations[1],
        "label",
        "Write bundled skill poe-generate.md to ~/.claude/skills",
    );
    let mut m = machine(Operation::Configure, None, false);
    m.start().unwrap();
    m.respond(Response::Exists(true)).unwrap();
    m.respond(Response::Content(
        templates::bundled(&u("poe-generate.md")).unwrap(),
    ))
    .unwrap();
    assert!(matches!(
        m.respond(Response::Template(
            templates::bundled(&u("poe-generate.md")).unwrap()
        )),
        Ok(Request::Done(_))
    ));
}
#[test]
fn unconfigure_preserves_modified_files_and_never_force_removes_shared_root() {
    for (force, expected) in [(false, 1), (true, 2)] {
        let mut m = machine(Operation::Unconfigure, Some(false), force);
        m.start().unwrap();
        m.respond(Response::Exists(true)).unwrap();
        let request = m.respond(Response::Content(u("user skill"))).unwrap();
        let request = if force {
            request
        } else {
            assert!(matches!(request, Request::Template(_)));
            m.respond(Response::Template(u("bundled"))).unwrap()
        };
        let Request::Done(plan) = request else {
            panic!()
        };
        assert_eq!(plan.mutations.len(), expected);
        let root = plan.mutations.last().unwrap();
        field(root, "kind", "removeDirectory");
        assert!(root.get("force").is_none());
        field(
            root,
            "label",
            "Remove empty skills directory .claude/skills",
        );
    }
    let mut m = machine(Operation::Unconfigure, None, false);
    m.start().unwrap();
    let Request::Done(plan) = m.respond(Response::Exists(false)).unwrap() else {
        panic!()
    };
    assert_eq!(plan.mutations.len(), 1);
}
#[test]
fn install_validates_names_and_force_skips_preflight_with_local_default() {
    let catalog = Catalog::builtins().unwrap();
    for name in [
        "",
        " ",
        "a ",
        ".",
        "..",
        "a/b",
        "a\\b",
        "a\nb",
        "a\rb",
        "\u{feff}a",
    ] {
        let error = Machine::new(
            &catalog,
            &u("claude"),
            Operation::Install {
                name: u(name),
                content: u("body"),
            },
            options(None, false),
        )
        .err()
        .unwrap();
        assert!(String::from_utf16_lossy(&error.message).starts_with("Invalid skill name:"));
    }
    let mut m = machine(
        Operation::Install {
            name: [u("😀"), vec![0xd800]].concat(),
            content: u("body"),
        },
        None,
        true,
    );
    let Request::Done(plan) = m.start().unwrap() else {
        panic!()
    };
    assert_eq!(plan.home, u("/repo"));
    assert_eq!(plan.template, Some(u("body")));
    assert!(plan.result.is_some());
    let mut m = machine(
        Operation::Install {
            name: u("valid"),
            content: u("body"),
        },
        None,
        false,
    );
    assert_eq!(
        m.start().unwrap(),
        Request::Stat(u("/repo/.claude/skills/valid/SKILL.md"))
    );
    let error = m.respond(Response::Exists(true)).unwrap_err();
    assert!(error.user);
    assert!(String::from_utf16_lossy(&error.message).contains("--force"));
}
#[test]
fn support_admission_and_request_state_are_explicit() {
    let catalog = Catalog::builtins().unwrap();
    assert!(
        Machine::new(
            &catalog,
            &u("unknown"),
            Operation::Configure,
            options(None, false)
        )
        .is_err()
    );
    let mut m = machine(Operation::Configure, None, false);
    assert!(m.respond(Response::Exists(false)).is_err());
    m.start().unwrap();
    assert!(m.respond(Response::Content(u("wrong response"))).is_err());
    for id in ["poe-generate.md", "terminal-pilot.md"] {
        assert!(!templates::bundled(&u(id)).unwrap().is_empty());
    }
    assert!(templates::bundled(&u("missing")).is_none());
}
