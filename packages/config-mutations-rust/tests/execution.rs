use config_mutations_rust::execution::{FileMachine, Kind, Outcome, Request, Response};
#[test]
fn ensure_walks_before_stat_and_creates_even_when_directory_existed() {
    let mut m = FileMachine::new(
        Kind::EnsureDirectory,
        vec![
            "/home/k/dir".encode_utf16().collect(),
            "/home/k".encode_utf16().collect(),
        ],
    );
    assert!(matches!(m.start().unwrap(), Request::InspectLink(_)));
    assert!(matches!(
        m.respond(Response::Missing).unwrap(),
        Request::InspectLink(_)
    ));
    assert_eq!(m.respond(Response::Link(false)).unwrap(), Request::Stat);
    assert_eq!(
        m.respond(Response::Stat(Some(0o755 as f64))).unwrap(),
        Request::DryRun
    );
    assert_eq!(
        m.respond(Response::DryRun(false)).unwrap(),
        Request::MakeDirectory
    );
    assert_eq!(
        m.respond(Response::Unit).unwrap(),
        Request::Done(Outcome {
            changed: false,
            effect: "mkdir",
            detail: "noop"
        })
    );
    assert!(m.respond(Response::Unit).is_err());
}
#[test]
fn symlink_stops_all_writes_before_dry_run_check() {
    let mut m = FileMachine::new(
        Kind::EnsureDirectory,
        vec!["/home/k/link".encode_utf16().collect()],
    );
    m.start().unwrap();
    assert_eq!(
        m.respond(Response::Link(true)).unwrap_err(),
        "Refusing mutation write through symbolic link: /home/k/link"
            .encode_utf16()
            .collect::<Vec<_>>()
    );
}
#[test]
fn directory_delete_requires_support_and_emptiness_unless_forced() {
    for force in [false, true] {
        for dry_run in [false, true] {
            let mut m = FileMachine::new(Kind::RemoveDirectory, vec![]);
            assert_eq!(m.start().unwrap(), Request::Stat);
            assert_eq!(
                m.respond(Response::Stat(None)).unwrap(),
                Request::DirectoryOptions
            );
            let mut request = m
                .respond(Response::DirectoryOptions {
                    supported: true,
                    force,
                })
                .unwrap();
            if !force {
                assert_eq!(request, Request::ReadEntries);
                request = m.respond(Response::Count(0)).unwrap();
            }
            assert_eq!(request, Request::DryRun);
            request = m.respond(Response::DryRun(dry_run)).unwrap();
            if !dry_run {
                assert_eq!(request, Request::RemoveDirectory);
                request = m.respond(Response::Unit).unwrap();
            }
            assert_eq!(
                request,
                Request::Done(Outcome {
                    changed: true,
                    effect: "delete",
                    detail: "delete"
                })
            );
        }
    }
    let mut m = FileMachine::new(Kind::RemoveDirectory, vec![]);
    m.start().unwrap();
    m.respond(Response::Stat(None)).unwrap();
    m.respond(Response::DirectoryOptions {
        supported: true,
        force: false,
    })
    .unwrap();
    assert_eq!(
        m.respond(Response::Count(1)).unwrap(),
        Request::Done(Outcome::noop())
    );
    let mut m = FileMachine::new(Kind::RemoveDirectory, vec![]);
    m.start().unwrap();
    m.respond(Response::Stat(None)).unwrap();
    assert_eq!(
        m.respond(Response::DirectoryOptions {
            supported: false,
            force: true
        })
        .unwrap(),
        Request::Done(Outcome::noop())
    );
}
#[test]
fn remove_reads_then_guards_and_missing_delete_is_noop() {
    let mut m = FileMachine::new(Kind::RemoveFile, vec![]);
    assert_eq!(m.start().unwrap(), Request::ReadFile);
    assert_eq!(
        m.respond(Response::Content(
            " \u{feff}\u{a0}\n".encode_utf16().collect()
        ))
        .unwrap(),
        Request::Guard(vec![])
    );
    assert_eq!(
        m.respond(Response::Guard {
            matches: true,
            when_empty: true
        })
        .unwrap(),
        Request::DryRun
    );
    assert_eq!(m.respond(Response::DryRun(false)).unwrap(), Request::Unlink);
    assert_eq!(
        m.respond(Response::Missing).unwrap(),
        Request::Done(Outcome::noop())
    );
    let mut m = FileMachine::new(Kind::RemoveFile, vec![]);
    m.start().unwrap();
    m.respond(Response::Content(vec![65])).unwrap();
    assert_eq!(
        m.respond(Response::Guard {
            matches: false,
            when_empty: false
        })
        .unwrap(),
        Request::Done(Outcome::noop())
    );
    let mut m = FileMachine::new(Kind::RemoveFile, vec![]);
    m.start().unwrap();
    m.respond(Response::Content(vec![65])).unwrap();
    assert_eq!(
        m.respond(Response::Guard {
            matches: true,
            when_empty: true
        })
        .unwrap(),
        Request::Done(Outcome::noop())
    );
}
#[test]
fn chmod_masks_current_mode_and_ignores_missing_or_unsupported() {
    let mut m = FileMachine::new(Kind::Chmod, vec![]);
    assert_eq!(m.start().unwrap(), Request::ChmodSupported);
    assert_eq!(
        m.respond(Response::ChmodSupported(true)).unwrap(),
        Request::Stat
    );
    assert_eq!(
        m.respond(Response::Stat(Some(0o100755 as f64))).unwrap(),
        Request::Mode
    );
    assert_eq!(
        m.respond(Response::Mode(0o755 as f64)).unwrap(),
        Request::Done(Outcome::noop())
    );
    let mut m = FileMachine::new(Kind::Chmod, vec![]);
    m.start().unwrap();
    m.respond(Response::ChmodSupported(true)).unwrap();
    m.respond(Response::Stat(None)).unwrap();
    assert_eq!(
        m.respond(Response::Mode(0o755 as f64)).unwrap(),
        Request::DryRun
    );
    assert_eq!(
        m.respond(Response::DryRun(false)).unwrap(),
        Request::SetMode(0o755 as f64)
    );
    assert_eq!(
        m.respond(Response::Unit).unwrap(),
        Request::Done(Outcome {
            changed: true,
            effect: "chmod",
            detail: "update"
        })
    );
    let mut m = FileMachine::new(Kind::Chmod, vec![]);
    m.start().unwrap();
    assert_eq!(
        m.respond(Response::ChmodSupported(false)).unwrap(),
        Request::Done(Outcome::noop())
    );
}
#[test]
fn invalid_response_does_not_advance_the_machine() {
    let mut m = FileMachine::new(Kind::RemoveDirectory, vec![]);
    m.start().unwrap();
    assert!(m.respond(Response::Unit).is_err());
    assert_eq!(
        m.respond(Response::Missing).unwrap(),
        Request::Done(Outcome::noop())
    );
}
