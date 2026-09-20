use config_mutations_rust::config::{
    ConfigMachine, Format, Kind, Request, Response, select_format,
};
use config_mutations_rust::execution::Outcome;
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn m(kind: Kind) -> ConfigMachine {
    ConfigMachine::new(kind, u("~/file.json"))
}
fn noop() -> Request {
    Request::Done(Outcome::noop())
}
#[test]
fn format_detection_matches_extension_and_override_contract() {
    assert_eq!(
        select_format(&u("~/file.JSON"), None).unwrap(),
        Format::Json
    );
    assert_eq!(
        select_format(&u("~/file"), Some(&u("nested.YML"))).unwrap(),
        Format::Yaml
    );
    assert!(select_format(&u("~/file.json/missing"), None).is_err());
    assert!(select_format(&u("~/file.json"), Some(&[])).is_err());
    assert_eq!(
        select_format(&u("file"), Some(&u("toml"))).unwrap(),
        Format::Toml
    );
}
#[test]
fn missing_prune_stops_before_format_guard_and_shape() {
    let mut m = m(Kind::Prune);
    assert_eq!(m.start().unwrap(), Request::Read);
    assert_eq!(m.respond(Response::Missing).unwrap(), noop());
}
#[test]
fn merge_validates_value_and_compares_serialized_text_before_writing() {
    let mut m = m(Kind::Merge);
    assert_eq!(m.start().unwrap(), Request::Format);
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Read);
    assert_eq!(
        m.respond(Response::Content(u("{}\n"))).unwrap(),
        Request::Parse(u("{}\n"))
    );
    assert_eq!(m.respond(Response::Parsed(true)).unwrap(), Request::Value);
    assert_eq!(m.respond(Response::Bool(true)).unwrap(), Request::Merge);
    assert_eq!(
        m.respond(Response::Unit).unwrap(),
        Request::Serialize(Some(u("{}\n")))
    );
    assert_eq!(m.respond(Response::Serialized(u("{}\n"))).unwrap(), noop());
}
#[test]
fn invalid_merge_backs_up_before_fresh_document_and_value_resolution() {
    let mut m = m(Kind::Merge);
    m.start().unwrap();
    m.respond(Response::Unit).unwrap();
    m.respond(Response::Content(u("bad"))).unwrap();
    assert_eq!(m.respond(Response::Parsed(false)).unwrap(), Request::DryRun);
    assert_eq!(
        m.respond(Response::Bool(false)).unwrap(),
        Request::BackupInvalid(u("bad"))
    );
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Fresh);
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Value);
    m.respond(Response::Bool(true)).unwrap();
    m.respond(Response::Unit).unwrap();
    assert_eq!(
        m.respond(Response::Serialized(u("{}\n"))).unwrap(),
        Request::DryRun
    );
    assert_eq!(
        m.respond(Response::Bool(true)).unwrap(),
        Request::Done(Outcome {
            changed: true,
            effect: "write",
            detail: "update"
        })
    );
}
#[test]
fn invalid_prune_noops_and_guard_false_does_not_prune() {
    let mut m = m(Kind::Prune);
    m.start().unwrap();
    m.respond(Response::Content(u("bad"))).unwrap();
    m.respond(Response::Unit).unwrap();
    assert_eq!(m.respond(Response::Parsed(false)).unwrap(), noop());
    let mut m = m_prune();
    m.start().unwrap();
    m.respond(Response::Content(u("{}"))).unwrap();
    m.respond(Response::Unit).unwrap();
    assert_eq!(m.respond(Response::Parsed(true)).unwrap(), Request::Guard);
    assert_eq!(m.respond(Response::Bool(false)).unwrap(), noop());
}
fn m_prune() -> ConfigMachine {
    m(Kind::Prune)
}
#[test]
fn prune_deletes_empty_result_and_writes_nonempty_without_text_comparison() {
    for empty in [false, true] {
        let mut m = m(Kind::Prune);
        m.start().unwrap();
        m.respond(Response::Content(u("{}\n"))).unwrap();
        m.respond(Response::Unit).unwrap();
        m.respond(Response::Parsed(true)).unwrap();
        m.respond(Response::Bool(true)).unwrap();
        let mut next = m
            .respond(Response::Pruned {
                changed: true,
                empty,
            })
            .unwrap();
        if !empty {
            assert_eq!(next, Request::Serialize(Some(u("{}\n"))));
            next = m.respond(Response::Serialized(u("{}\n"))).unwrap();
        }
        assert_eq!(next, Request::DryRun);
        assert_eq!(
            m.respond(Response::Bool(false)).unwrap(),
            if empty {
                Request::Unlink
            } else {
                Request::WriteAtomically(u("{}\n"))
            }
        );
        assert!(matches!(
            m.respond(Response::Unit).unwrap(),
            Request::Done(Outcome { changed: true, .. })
        ));
    }
}
#[test]
fn transform_null_only_deletes_an_existing_document() {
    for existed in [false, true] {
        let mut m = m(Kind::Transform);
        m.start().unwrap();
        m.respond(Response::Unit).unwrap();
        if existed {
            m.respond(Response::Content(u("{}"))).unwrap();
            m.respond(Response::Parsed(true)).unwrap();
        } else {
            assert_eq!(m.respond(Response::Missing).unwrap(), Request::Fresh);
            m.respond(Response::Unit).unwrap();
        }
        let next = m
            .respond(Response::Transformed {
                changed: true,
                deleted: true,
            })
            .unwrap();
        assert_eq!(next, if existed { Request::DryRun } else { noop() });
    }
}
#[test]
fn merge_rejects_invalid_value_with_raw_target_and_errors_release_state() {
    let mut m = m(Kind::Merge);
    m.start().unwrap();
    m.respond(Response::Unit).unwrap();
    m.respond(Response::Missing).unwrap();
    m.respond(Response::Unit).unwrap();
    assert_eq!(
        m.respond(Response::Bool(false)).unwrap_err(),
        u("configMerge value must be an object for \"~/file.json\".")
    );
    assert!(m.respond(Response::Unit).is_err());
}
