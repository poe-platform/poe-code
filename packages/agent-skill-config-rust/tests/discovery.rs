use agent_skill_config_rust::discovery::{Machine, Request};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn discovery_orders_utf16_names_and_remembers_only_loaded_paths() {
    let mut machine = Machine::default();
    assert_eq!(machine.start(u("/skills")), Request::Root(u("/skills")));
    assert_eq!(machine.root(false).unwrap(), Request::Names(u("/skills")));
    assert_eq!(
        machine.names(vec![u("\u{e000}"), u("\u{10000}"), u("a")]),
        Request::Child {
            root: u("/skills"),
            name: u("a")
        }
    );
    assert_eq!(
        machine.directory(true),
        Request::FilePath {
            root: u("/skills"),
            name: u("a")
        }
    );
    assert_eq!(
        machine.file(u("/skills/a/SKILL.md")),
        Request::File(u("/skills/a/SKILL.md"))
    );
    assert_eq!(
        machine.missing(),
        Request::Child {
            root: u("/skills"),
            name: u("\u{10000}")
        }
    );
    machine.directory(true);
    machine.file(u("/skills/astral/SKILL.md"));
    assert_eq!(
        machine.regular(true).unwrap(),
        Request::Read {
            name: u("\u{10000}"),
            file: u("/skills/astral/SKILL.md")
        }
    );
    assert_eq!(
        machine.loaded(),
        Request::Child {
            root: u("/skills"),
            name: u("\u{e000}")
        }
    );
    assert_eq!(machine.directory(false), Request::Done);
    machine.start(u("/skills"));
    machine.root(false).unwrap();
    machine.names(vec![u("a"), u("astral")]);
    machine.directory(true);
    assert_eq!(
        machine.file(u("/skills/a/SKILL.md")),
        Request::File(u("/skills/a/SKILL.md"))
    );
    machine.regular(true).unwrap();
    machine.loaded();
    machine.directory(true);
    assert_eq!(machine.file(u("/skills/astral/SKILL.md")), Request::Done);
}

#[test]
fn discovery_rejects_links_and_nonregular_files_with_reference_messages() {
    let mut machine = Machine::default();
    machine.start(u("/link"));
    assert_eq!(
        machine.root(true),
        Err(u("Skill directory must not be a symbolic link: /link"))
    );
    machine.start(u("/skills"));
    machine.root(false).unwrap();
    machine.names(vec![u("demo")]);
    machine.directory(true);
    machine.file(u("/skills/demo/SKILL.md"));
    assert_eq!(
        machine.regular(false),
        Err(u(
            "Skill file must be a regular file: /skills/demo/SKILL.md"
        ))
    );
}
