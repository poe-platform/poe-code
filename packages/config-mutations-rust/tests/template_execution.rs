use config_mutations_rust::{
    config::{Request as ConfigRequest, Response as ConfigResponse},
    execution::Outcome,
    template_execution::{Kind, Request, Response, TemplateMachine},
};
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn rendered(kind: Kind) -> TemplateMachine {
    let mut m = TemplateMachine::new(kind);
    assert_eq!(m.start().unwrap(), Request::Loader);
    assert_eq!(
        m.respond(Response::Supported(true)).unwrap(),
        Request::Resolve
    );
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Load);
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Context);
    assert_eq!(m.respond(Response::Unit).unwrap(), Request::Render);
    m
}
#[test]
fn loader_admission_precedes_target_resolution() {
    let mut m = TemplateMachine::new(Kind::Write);
    assert_eq!(m.start().unwrap(), Request::Loader);
    assert_eq!(
        String::from_utf16(&m.respond(Response::Supported(false)).unwrap_err()).unwrap(),
        "Template mutations require a templates loader. Provide templates function to runMutations context."
    );
    assert!(m.start().is_err());
}
#[test]
fn template_write_compares_content_and_retains_dry_run_create_update_noop() {
    for existing in [None, Some("before"), Some("rendered")] {
        for dry in [false, true] {
            let mut m = rendered(Kind::Write);
            assert_eq!(
                m.respond(Response::Rendered(u("rendered"))).unwrap(),
                Request::Read
            );
            let r = m
                .respond(
                    existing
                        .map(|v| Response::Content(u(v)))
                        .unwrap_or(Response::Missing),
                )
                .unwrap();
            if existing == Some("rendered") {
                assert_eq!(r, Request::Done(Outcome::noop()));
                continue;
            }
            assert_eq!(r, Request::DryRun);
            let outcome = Outcome {
                changed: true,
                effect: "write",
                detail: if existing.is_none() {
                    "create"
                } else {
                    "update"
                },
            };
            let r = m.respond(Response::DryRun(dry)).unwrap();
            if dry {
                assert_eq!(r, Request::Done(outcome));
            } else {
                assert_eq!(r, Request::Write(u("rendered")));
                assert_eq!(m.respond(Response::Unit).unwrap(), Request::Done(outcome));
            }
        }
    }
}
#[test]
fn rendered_template_parse_failure_has_own_context_and_stops_before_read() {
    for (kind, name) in [(Kind::MergeJson, "JSON"), (Kind::MergeToml, "TOML")] {
        let mut m = rendered(kind);
        assert_eq!(
            m.respond(Response::Rendered(u("broken"))).unwrap(),
            Request::ParseRendered
        );
        let message = m
            .respond(Response::InvalidTemplate {
                id: u("🦀\""),
                error: u("foreign failure"),
            })
            .unwrap_err();
        assert_eq!(
            String::from_utf16(&message).unwrap(),
            format!("Failed to parse rendered template \"🦀\"\" as {name}: foreign failure")
        );
        assert!(m.respond(Response::Unit).is_err());
    }
}
#[test]
fn template_merge_reuses_config_policy_with_full_serialization_and_no_value_admission() {
    let mut m = rendered(Kind::MergeJson);
    assert_eq!(
        m.respond(Response::Rendered(u("{\"added\":true}")))
            .unwrap(),
        Request::ParseRendered
    );
    assert_eq!(
        m.respond(Response::Unit).unwrap(),
        Request::Config(ConfigRequest::Read)
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Content(u("{}"))))
            .unwrap(),
        Request::Config(ConfigRequest::Parse(u("{}")))
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Parsed(true)))
            .unwrap(),
        Request::Config(ConfigRequest::Merge)
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Unit)).unwrap(),
        Request::Config(ConfigRequest::Serialize(None))
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Serialized(u(
            "{\"added\":true}\n"
        ))))
        .unwrap(),
        Request::Config(ConfigRequest::DryRun)
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Bool(true)))
            .unwrap(),
        Request::Config(ConfigRequest::Done(Outcome {
            changed: true,
            effect: "write",
            detail: "update"
        }))
    );
}
#[test]
fn template_merge_backs_up_invalid_current_before_fresh_merge() {
    let mut m = rendered(Kind::MergeToml);
    m.respond(Response::Rendered(u("added=true"))).unwrap();
    m.respond(Response::Unit).unwrap();
    m.respond(Response::Config(ConfigResponse::Content(u("broken"))))
        .unwrap();
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Parsed(false)))
            .unwrap(),
        Request::Config(ConfigRequest::DryRun)
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Bool(false)))
            .unwrap(),
        Request::Config(ConfigRequest::BackupInvalid(u("broken")))
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Unit)).unwrap(),
        Request::Config(ConfigRequest::Fresh)
    );
    assert_eq!(
        m.respond(Response::Config(ConfigResponse::Unit)).unwrap(),
        Request::Config(ConfigRequest::Merge)
    );
}
