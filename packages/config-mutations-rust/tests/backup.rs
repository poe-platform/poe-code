use config_mutations_rust::backup::{BackupMachine, Kind, Request, Response, WriteError};
use config_mutations_rust::execution::Outcome;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn m(kind: Kind) -> BackupMachine {
    BackupMachine::new(kind, u("/home/k/file"), vec![])
}
fn copied(detail: &'static str) -> Request {
    Request::Done(Outcome {
        changed: true,
        effect: "copy",
        detail,
    })
}
#[test]
fn backup_once_finds_existing_baseline_before_reading_target() {
    let mut m = m(Kind::Backup);
    assert_eq!(m.start().unwrap(), Request::Once);
    assert_eq!(
        m.respond(Response::Bool(true)).unwrap(),
        Request::List(u("/home/k"))
    );
    assert_eq!(
        m.respond(Response::Entries(vec![u(
            "file.backup-2026-09-20T10-20-30-000Z"
        )]))
        .unwrap(),
        Request::ValidateTimestamp(u("2026-09-20T10:20:30.000Z"))
    );
    assert_eq!(
        m.respond(Response::Bool(true)).unwrap(),
        Request::Done(Outcome::noop())
    );
}
#[test]
fn missing_target_preserves_only_requested_missing_baseline() {
    for once in [false, true] {
        let mut m = m(Kind::Backup);
        m.start().unwrap();
        m.respond(Response::Bool(false)).unwrap();
        assert_eq!(m.respond(Response::Missing).unwrap(), Request::Once);
        let next = m.respond(Response::Bool(once)).unwrap();
        if once {
            assert_eq!(next, Request::DryRun);
            assert_eq!(m.respond(Response::Bool(true)).unwrap(), copied("backup"));
        } else {
            assert_eq!(next, Request::Done(Outcome::noop()));
        }
    }
}
#[test]
fn backup_formats_timestamp_and_retries_exclusive_collisions() {
    let mut m = m(Kind::Backup);
    m.start().unwrap();
    m.respond(Response::Bool(false)).unwrap();
    m.respond(Response::Content(u("before"))).unwrap();
    assert_eq!(
        m.respond(Response::Bool(false)).unwrap(),
        Request::Timestamp
    );
    assert_eq!(
        m.respond(Response::Timestamp(u("2026-09-20T10:20:30.000Z")))
            .unwrap(),
        Request::Walk(u("/home/k/file.backup-2026-09-20T10-20-30-000Z"))
    );
    assert!(matches!(
        m.respond(Response::Walk(vec![])).unwrap(),
        Request::WriteExclusive { .. }
    ));
    assert_eq!(
        m.respond(Response::Failure {
            exists: true,
            token: 7
        })
        .unwrap(),
        Request::Walk(u("/home/k/file.backup-2026-09-20T10-20-30-000Z-1"))
    );
    m.respond(Response::Walk(vec![])).unwrap();
    assert_eq!(m.respond(Response::Unit).unwrap(), copied("backup"));
}
#[test]
fn failed_backup_cleans_before_returning_original_host_token() {
    let mut m = m(Kind::Backup);
    m.start().unwrap();
    m.respond(Response::Bool(false)).unwrap();
    m.respond(Response::Content(u("before"))).unwrap();
    m.respond(Response::Bool(false)).unwrap();
    m.respond(Response::Timestamp(u("date"))).unwrap();
    m.respond(Response::Walk(vec![])).unwrap();
    assert_eq!(
        m.respond(Response::Failure {
            exists: false,
            token: 7
        })
        .unwrap(),
        Request::Unlink {
            path: u("/home/k/file.backup-date"),
            ignore_missing: false,
            cleanup: true
        }
    );
    assert_eq!(
        m.respond(Response::Failure {
            exists: false,
            token: 8
        })
        .unwrap(),
        Request::Error(WriteError::Host(7))
    );
}
#[test]
fn restore_selects_utf16_lexical_latest_and_consumes_only_after_atomic_write() {
    let mut m = m(Kind::Restore);
    assert_eq!(m.start().unwrap(), Request::List(u("/home/k")));
    m.respond(Response::Entries(vec![
        u("other.backup-2026-09-20T10-20-30-000Z"),
        u("file.backup-2026-09-20T10-20-30-000Z-2"),
        u("file.backup-2026-09-20T10-20-30-000Z-10"),
    ]))
    .unwrap();
    m.respond(Response::Bool(true)).unwrap();
    assert_eq!(m.respond(Response::Bool(true)).unwrap(), Request::DryRun);
    assert_eq!(
        m.respond(Response::Bool(false)).unwrap(),
        Request::Walk(u("/home/k/file.backup-2026-09-20T10-20-30-000Z-2"))
    );
    assert_eq!(
        m.respond(Response::Walk(vec![])).unwrap(),
        Request::Read {
            path: u("/home/k/file.backup-2026-09-20T10-20-30-000Z-2"),
            missing_allowed: false
        }
    );
    assert_eq!(
        m.respond(Response::Content(u("before"))).unwrap(),
        Request::WriteAtomically {
            path: u("/home/k/file"),
            content: u("before")
        }
    );
    assert!(matches!(
        m.respond(Response::Unit).unwrap(),
        Request::Unlink { .. }
    ));
    assert_eq!(m.respond(Response::Unit).unwrap(), copied("restore"));
}
#[test]
fn restore_missing_baseline_ignores_missing_target_and_consumes_marker() {
    let mut m = m(Kind::Restore);
    m.start().unwrap();
    m.respond(Response::Entries(vec![u(
        "file.backup-2026-09-20T10-20-30-000Z.missing",
    )]))
    .unwrap();
    m.respond(Response::Bool(true)).unwrap();
    m.respond(Response::Bool(false)).unwrap();
    assert_eq!(
        m.respond(Response::Walk(vec![])).unwrap(),
        Request::Unlink {
            path: u("/home/k/file"),
            ignore_missing: true,
            cleanup: false
        }
    );
    assert!(matches!(
        m.respond(Response::Missing).unwrap(),
        Request::Unlink {
            ignore_missing: false,
            ..
        }
    ));
    assert_eq!(m.respond(Response::Unit).unwrap(), copied("restore"));
}
#[test]
fn invalid_suffixes_are_date_checked_before_rejection_and_missing_collisions_match_sdk() {
    let mut m = m(Kind::Restore);
    m.start().unwrap();
    m.respond(Response::Entries(vec![
        u("file.backup-2026-09-20T10-20-30-000Z.missing-1"),
        u("file.backup-2026-09-20T10-20-30-000Z-x"),
        u("file.backup-2026-09-20T10-20-30-000Z"),
    ]))
    .unwrap();
    m.respond(Response::Bool(true)).unwrap();
    m.respond(Response::Bool(true)).unwrap();
    assert_eq!(
        m.respond(Response::Bool(false)).unwrap(),
        Request::Done(Outcome::noop())
    );
}
#[test]
fn target_symlinks_reject_before_once_and_dry_restore_skips_link_checks() {
    let mut m = BackupMachine::new(Kind::Backup, u("target"), vec![u("link")]);
    assert!(matches!(m.start().unwrap(), Request::InspectLink(_)));
    assert_eq!(
        m.respond(Response::Link(true)).unwrap(),
        Request::Error(WriteError::Message(u(
            "Refusing mutation write through symbolic link: link"
        )))
    );
    let mut m = m_restore();
    m.start().unwrap();
    m.respond(Response::Entries(vec![u(
        "file.backup-2026-09-20T10-20-30-000Z",
    )]))
    .unwrap();
    m.respond(Response::Bool(true)).unwrap();
    assert_eq!(m.respond(Response::Bool(true)).unwrap(), copied("restore"));
}
fn m_restore() -> BackupMachine {
    m(Kind::Restore)
}
