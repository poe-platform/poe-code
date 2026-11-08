use agent_mcp_config_rust::decision::{Decision, MapState, Mode, Request, Response};
fn new(mode: Mode) -> Decision {
    Decision::new(
        mode,
        "mcp".encode_utf16().collect(),
        "~/config.json".encode_utf16().collect(),
    )
}
#[test]
fn configure_noops_or_conflicts_before_any_spread() {
    let mut policy = new(Mode::Configure);
    assert_eq!(policy.request(), Request::Map);
    policy.respond(Response::Map(MapState::Valid)).unwrap();
    assert_eq!(policy.request(), Request::Existing);
    policy.respond(Response::Flag(true)).unwrap();
    assert_eq!(policy.request(), Request::EqualsShaped);
    policy.respond(Response::Flag(true)).unwrap();
    assert_eq!(policy.request(), Request::Noop);
    let mut policy = new(Mode::Configure);
    for response in [
        Response::Map(MapState::Valid),
        Response::Flag(true),
        Response::Flag(false),
        Response::Flag(false),
    ] {
        policy.respond(response).unwrap();
    }
    assert_eq!(policy.request(), Request::ConflictName);
    policy.respond(Response::Name(vec![0xd800])).unwrap();
    let Request::Error(message) = policy.request() else {
        panic!()
    };
    assert!(message.contains(&0xd800));
}
#[test]
fn configure_accepts_empty_map_and_canonical_enabled_replacement() {
    let mut policy = new(Mode::Configure);
    policy.respond(Response::Map(MapState::Missing)).unwrap();
    assert_eq!(policy.request(), Request::EmptyMap);
    policy.respond(Response::Unit).unwrap();
    policy.respond(Response::Flag(false)).unwrap();
    assert_eq!(policy.request(), Request::Upsert);
    let mut policy = new(Mode::Configure);
    for response in [
        Response::Map(MapState::Valid),
        Response::Flag(true),
        Response::Flag(false),
        Response::Flag(true),
        Response::Flag(true),
    ] {
        policy.respond(response).unwrap();
    }
    assert_eq!(policy.request(), Request::Upsert);
}
#[test]
fn unconfigure_guards_expected_shape_and_removes_empty_key() {
    let mut policy = new(Mode::Unconfigure);
    for response in [
        Response::Map(MapState::Valid),
        Response::Flag(true),
        Response::Flag(true),
        Response::Flag(false),
    ] {
        policy.respond(response).unwrap();
    }
    assert_eq!(policy.request(), Request::Noop);
    for empty in [true, false] {
        let mut policy = new(Mode::Unconfigure);
        for response in [
            Response::Map(MapState::Valid),
            Response::Flag(true),
            Response::Flag(false),
        ] {
            policy.respond(response).unwrap();
        }
        assert_eq!(policy.request(), Request::Delete);
        policy.respond(Response::Flag(empty)).unwrap();
        assert_eq!(
            policy.request(),
            if empty {
                Request::RemoveKey
            } else {
                Request::UpdateMap
            }
        );
    }
}
#[test]
fn invalid_maps_fail_before_names_and_terminal_replies_are_rejected() {
    let mut policy = new(Mode::Configure);
    assert!(policy.respond(Response::Unit).is_err());
    assert_eq!(policy.request(), Request::Map);
    policy.respond(Response::Map(MapState::Invalid)).unwrap();
    assert_eq!(
        policy.request(),
        Request::Error("Expected mcp to be an object.".encode_utf16().collect())
    );
    assert!(policy.respond(Response::Flag(true)).is_err());
}
