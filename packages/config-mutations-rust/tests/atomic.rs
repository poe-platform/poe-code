use config_mutations_rust::atomic::{AtomicMachine, Failure, Request, Response, WriteError};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn machine() -> AtomicMachine {
    AtomicMachine::new(
        u("/home/k/file"),
        u("value"),
        vec![u("/home/k/file"), u("/home/k")],
    )
}
fn reach_write(m: &mut AtomicMachine) {
    assert_eq!(m.start().unwrap(), Request::InspectLink(u("/home/k/file")));
    assert_eq!(
        m.respond(Response::Missing).unwrap(),
        Request::InspectLink(u("/home/k"))
    );
    assert_eq!(m.respond(Response::Link(false)).unwrap(), Request::TempPath);
    assert_eq!(
        m.respond(Response::Temp {
            path: u("temp"),
            walk: vec![]
        })
        .unwrap(),
        Request::WriteExclusive {
            path: u("temp"),
            content: u("value")
        }
    );
}
#[test]
fn writes_exclusively_then_renames_without_cleanup_on_success() {
    let mut m = machine();
    reach_write(&mut m);
    assert_eq!(
        m.respond(Response::Unit).unwrap(),
        Request::Rename {
            from: u("temp"),
            to: u("/home/k/file")
        }
    );
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Done);
    assert!(m.respond(Response::Unit).is_err());
}
#[test]
fn write_collisions_retry_without_unlinking_someone_elses_file() {
    let mut m = machine();
    reach_write(&mut m);
    assert_eq!(
        m.respond(Response::Failure {
            kind: Failure::Exists,
            token: 7
        })
        .unwrap(),
        Request::TempPath
    );
    assert!(matches!(
        m.respond(Response::Temp {
            path: u("new"),
            walk: vec![]
        })
        .unwrap(),
        Request::WriteExclusive { .. }
    ));
}
#[test]
fn rename_collisions_clean_own_temp_before_retry_and_ignore_cleanup_errors() {
    let mut m = machine();
    reach_write(&mut m);
    m.respond(Response::Unit).unwrap();
    assert_eq!(
        m.respond(Response::Failure {
            kind: Failure::Exists,
            token: 7
        })
        .unwrap(),
        Request::Cleanup(u("temp"))
    );
    assert_eq!(
        m.respond(Response::Failure {
            kind: Failure::Other,
            token: 8
        })
        .unwrap(),
        Request::TempPath
    );
}
#[test]
fn other_write_and_rename_errors_clean_then_rethrow_original_token() {
    for rename in [false, true] {
        let mut m = machine();
        reach_write(&mut m);
        if rename {
            m.respond(Response::Unit).unwrap();
        }
        assert_eq!(
            m.respond(Response::Failure {
                kind: Failure::Other,
                token: 7
            })
            .unwrap(),
            Request::Cleanup(u("temp"))
        );
        assert_eq!(
            m.respond(Response::Unit).unwrap(),
            Request::Error(WriteError::Host(7))
        );
    }
}
#[test]
fn target_symlink_rejects_directly_but_temp_symlink_cleans() {
    let mut m = machine();
    m.start().unwrap();
    assert_eq!(
        m.respond(Response::Link(true)).unwrap(),
        Request::Error(WriteError::Message(u(
            "Refusing mutation write through symbolic link: /home/k/file"
        )))
    );
    let mut m = AtomicMachine::new(u("target"), vec![], vec![]);
    m.start().unwrap();
    m.respond(Response::Temp {
        path: u("temp"),
        walk: vec![u("temp")],
    })
    .unwrap();
    assert_eq!(
        m.respond(Response::Link(true)).unwrap(),
        Request::Cleanup(u("temp"))
    );
    assert!(matches!(
        m.respond(Response::Unit).unwrap(),
        Request::Error(WriteError::Message(_))
    ));
}
#[test]
fn exactly_ten_collisions_exhaust_the_retry_budget() {
    let mut m = AtomicMachine::new(u("target"), vec![], vec![]);
    assert_eq!(m.start().unwrap(), Request::TempPath);
    for i in 0..10 {
        m.respond(Response::Temp {
            path: u("temp"),
            walk: vec![],
        })
        .unwrap();
        let next = m
            .respond(Response::Failure {
                kind: Failure::Exists,
                token: i,
            })
            .unwrap();
        assert_eq!(
            next,
            if i == 9 {
                Request::Error(WriteError::Message(u(
                    "Unable to create temporary mutation file for target.",
                )))
            } else {
                Request::TempPath
            }
        );
    }
}
#[test]
fn target_and_random_path_errors_do_not_attempt_cleanup() {
    let mut m = machine();
    m.start().unwrap();
    assert_eq!(
        m.respond(Response::Failure {
            kind: Failure::Other,
            token: 4
        })
        .unwrap(),
        Request::Error(WriteError::Host(4))
    );
    let mut m = AtomicMachine::new(u("target"), vec![], vec![]);
    m.start().unwrap();
    assert_eq!(
        m.respond(Response::Failure {
            kind: Failure::Exists,
            token: 5
        })
        .unwrap(),
        Request::Error(WriteError::Host(5))
    );
}
