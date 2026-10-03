use agent_skill_config_rust::exclude_async::{Machine, Request, Response};
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn async_exclude_walks_parents_and_preserves_atomic_cleanup_order() {
    let mut machine = Machine::new(u("run"), u("custom"), false);
    assert_eq!(
        machine.start(u("/repo/child")),
        Request::Join(vec![u("/repo/child"), u(".git")])
    );
    machine
        .respond(Response::Path(u("/repo/child/.git")))
        .unwrap();
    assert_eq!(
        machine.missing().unwrap(),
        Request::Parent(u("/repo/child"))
    );
    machine.respond(Response::Path(u("/repo"))).unwrap();
    machine.respond(Response::Path(u("/repo/.git"))).unwrap();
    machine
        .respond(Response::Stat {
            symbolic: false,
            directory: true,
        })
        .unwrap();
    assert_eq!(
        machine
            .respond(Response::Path(u("/repo/.git/info/exclude")))
            .unwrap(),
        Request::AcquireFs
    );
    machine.respond(Response::Unit).unwrap();
    assert_eq!(machine.missing().unwrap(), Request::Entries);
    machine
        .respond(Response::Entries(vec![u("late\nentry")]))
        .unwrap();
    for parent in ["/repo/.git/info", "/repo/.git", "/repo", "/"] {
        machine
            .respond(Response::Stat {
                symbolic: false,
                directory: false,
            })
            .unwrap();
        machine.respond(Response::Path(u(parent))).unwrap();
    }
    machine
        .respond(Response::Stat {
            symbolic: false,
            directory: false,
        })
        .unwrap();
    machine.respond(Response::Path(u("/"))).unwrap();
    assert_eq!(
        machine
            .respond(Response::Path(u("/repo/.git/info")))
            .unwrap(),
        Request::Mkdir(u("/repo/.git/info"))
    );
    machine.respond(Response::Unit).unwrap();
    assert!(matches!(
        machine.respond(Response::Path(u("/tmp/file"))).unwrap(),
        Request::Write { .. }
    ));
    assert!(machine.failed().is_none());
    assert!(matches!(
        machine.respond(Response::Unit).unwrap(),
        Request::Rename { .. }
    ));
    assert_eq!(machine.failed(), Some(Request::Cleanup(u("/tmp/file"))));
    assert_eq!(
        machine.respond(Response::Unit).unwrap(),
        Request::Done(Some(u("run")))
    );
}
#[test]
fn missing_git_at_root_finishes_and_symbolic_metadata_is_rejected() {
    let mut machine = Machine::new(u("run"), u("p"), true);
    machine.start(u("/"));
    machine.respond(Response::Path(u("/.git"))).unwrap();
    machine.missing().unwrap();
    assert_eq!(
        machine.respond(Response::Path(u("/"))).unwrap(),
        Request::Done(None)
    );
    machine.start(u("/repo"));
    machine.respond(Response::Path(u("/repo/.git"))).unwrap();
    assert_eq!(
        machine.respond(Response::Stat {
            symbolic: true,
            directory: false
        }),
        Err(u("Refusing symbolic Git directory"))
    );
}
