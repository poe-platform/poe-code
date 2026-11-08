use providers_rust::{Registry, rank};
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
#[test]
fn provider_identity_and_storage_keys_are_independent_exact_names() {
    let mut registry = Registry::default();
    assert_eq!(
        registry.insert(units("poe"), Some(units("provider:poe"))),
        Ok(0)
    );
    assert_eq!(registry.insert(units("oauth"), None), Ok(1));
    assert_eq!(registry.get(&units("poe")), Some(0));
    assert_eq!(registry.get(&units("POE")), None);
    assert!(registry.insert(units("poe"), None).is_err());
    assert!(
        registry
            .insert(units("other"), Some(units("provider:poe")))
            .is_err()
    );
    assert_eq!(registry.insert(vec![0xd800], Some(vec![0xd800])), Ok(2));
    assert_eq!(registry.insert(vec![0xfffd], Some(vec![0xfffd])), Ok(3));
}
#[test]
fn provider_order_is_declarative_auth_and_url_policy() {
    assert_eq!(rank(true, true, true), 0);
    assert_eq!(rank(true, false, false), 1);
    assert_eq!(rank(false, true, true), 2);
}

#[test]
fn provider_definition_errors_are_returned_without_panics() {
    assert!(providers_rust::definition("broken", b"{").is_err());
    assert!(providers_rust::definition("broken", b"[]").is_err());
    let parsed = providers_rust::definition("file-id", br#"{"label":"Name"}"#).unwrap();
    assert_eq!(
        parsed.get("id"),
        Some(&mcp_protocol_rust::json::Value::String(units("file-id")))
    );
}

#[test]
fn ordered_shape_scanning_short_circuits_and_preserves_host_failures() {
    let mut next = 0;
    let found = providers_rust::first_match(
        || {
            next += 1;
            Ok::<_, &str>(Some(next))
        },
        |value| Ok(*value == 3),
    );
    assert_eq!(found, Ok(Some(3)));
    assert_eq!(next, 3);
    let failed = providers_rust::first_match(|| Ok::<_, &str>(Some(1)), |_| Err("host failure"));
    assert_eq!(failed, Err("host failure"));
    assert_eq!(
        providers_rust::resolve_shape(
            &[units("responses"), units("chat")],
            &[units("chat"), units("responses")]
        ),
        Some(0)
    );
}
