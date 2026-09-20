use agent_skill_config_rust::templates::{Machine, Request, Response};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn template_discovery_walks_roots_and_candidates_in_order() {
    let mut m = Machine::new(&u("poe-generate.md"), u("/pkg/dist")).unwrap();
    assert_eq!(
        m.start().unwrap(),
        Request::Join(vec![u("/pkg/dist"), u("package.json")])
    );
    m.respond(Response::Path(u("/pkg/dist/package.json")))
        .unwrap();
    assert_eq!(
        m.respond(Response::Exists(false)).unwrap(),
        Request::Parent(u("/pkg/dist"))
    );
    m.respond(Response::Path(u("/pkg"))).unwrap();
    m.respond(Response::Path(u("/pkg/package.json"))).unwrap();
    assert_eq!(
        m.respond(Response::Exists(true)).unwrap(),
        Request::Join(vec![
            u("/pkg"),
            u("src"),
            u("templates"),
            u("poe-generate.md")
        ])
    );
    m.respond(Response::Path(u("/pkg/src/templates/poe-generate.md")))
        .unwrap();
    assert_eq!(
        m.respond(Response::Exists(false)).unwrap(),
        Request::Join(vec![
            u("/pkg"),
            u("dist"),
            u("templates"),
            u("poe-generate.md")
        ])
    );
    m.respond(Response::Path(u("/pkg/dist/templates/poe-generate.md")))
        .unwrap();
    assert_eq!(
        m.respond(Response::Exists(true)).unwrap(),
        Request::Read(u("/pkg/dist/templates/poe-generate.md"))
    );
    assert_eq!(
        m.respond(Response::Content(u("body"))).unwrap(),
        Request::Done(u("body"))
    );
}
#[test]
fn missing_templates_and_root_termination_are_errors_without_looping() {
    assert!(Machine::new(&u("missing"), u("/pkg")).is_err());
    let mut m = Machine::new(&u("terminal-pilot.md"), u("/")).unwrap();
    m.start().unwrap();
    m.respond(Response::Path(u("/package.json"))).unwrap();
    m.respond(Response::Exists(false)).unwrap();
    assert!(m.respond(Response::Path(u("/"))).is_err());
    let mut m = Machine::new(&u("terminal-pilot.md"), u("/pkg")).unwrap();
    m.start().unwrap();
    m.respond(Response::Path(u("/pkg/package.json"))).unwrap();
    m.respond(Response::Exists(true)).unwrap();
    for path in [
        "/pkg/src/templates/terminal-pilot.md",
        "/pkg/dist/templates/terminal-pilot.md",
    ] {
        m.respond(Response::Path(u(path))).unwrap();
        m.respond(Response::Exists(false)).unwrap();
    }
    m.respond(Response::Path(u(
        "/pkg/dist/templates/skill/terminal-pilot.md",
    )))
    .unwrap();
    assert!(m.respond(Response::Exists(false)).is_err());
}
