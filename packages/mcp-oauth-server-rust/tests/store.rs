use mcp_oauth_server_rust::store::{Kind, Record, Rotation, Store};
use mcp_protocol_rust::json::{self, Limits, Value};
fn record(text: &str) -> Record {
    Record::new(
        vec![1, 2, 3],
        json::parse(text.as_bytes(), Limits::default()).unwrap(),
    )
}
fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn records_are_cloned_and_transaction_codes_are_taken_once() {
    let mut store = Store::default();
    store
        .put(Kind::Transaction, record(r#"{"id":"tx"}"#))
        .unwrap();
    let mut first = store.take(Kind::Transaction, &text("tx")).unwrap();
    first.payload = vec![1, 2, 3, 4].into();
    assert!(store.take(Kind::Transaction, &text("tx")).is_none());
    store
        .put(Kind::Client, record(r#"{"id":"client"}"#))
        .unwrap();
    let mut clone = store.get(Kind::Client, &text("client")).unwrap();
    clone.payload = vec![1, 2, 3, 4].into();
    assert_eq!(
        store
            .get(Kind::Client, &text("client"))
            .unwrap()
            .payload
            .as_ref(),
        &[1, 2, 3]
    );
}
#[test]
fn refresh_rotation_is_atomic_and_replay_revokes_only_its_family_grants() {
    let mut store = Store::default();
    store.put(Kind::Grant, record(r#"{"id":"g"}"#)).unwrap();
    store.put(Kind::Grant, record(r#"{"id":"other"}"#)).unwrap();
    store.put(Kind::Refresh,record(r#"{"tokenHash":"r","familyId":"f","grantId":"g","expiresAt":100,"status":"active"}"#)).unwrap();
    store.put(Kind::Refresh,record(r#"{"tokenHash":"unrelated","familyId":"else","grantId":"other","expiresAt":100,"status":"active"}"#)).unwrap();
    match store.rotate(&text("r"), text("replacement"), 10.0, 200.0) {
        Rotation::Rotated(previous) => assert_eq!(
            previous.attributes.get("status"),
            Some(&Value::String(text("active")))
        ),
        _ => panic!("initial rotation must succeed"),
    }
    match store.rotate(&text("r"), text("another"), 20.0, 300.0) {
        Rotation::Replay(Some(grant)) => assert_eq!(
            grant.attributes.get("revokedAt"),
            Some(&Value::Number(20.0))
        ),
        _ => panic!("replay must revoke grant"),
    }
    assert!(matches!(
        store.rotate(&text("replacement"), text("bad"), 30.0, 300.0),
        Rotation::Invalid
    ));
    assert!(
        store
            .get(Kind::Grant, &text("other"))
            .unwrap()
            .attributes
            .get("revokedAt")
            .is_none()
    );
}
#[test]
fn expiration_precedes_replay_and_access_revocation_reports_original_grant_once() {
    let mut store = Store::default();
    store.put(Kind::Grant, record(r#"{"id":"g"}"#)).unwrap();
    store
        .put(Kind::Access, record(r#"{"tokenHash":"a","grantId":"g"}"#))
        .unwrap();
    assert!(store.revoke_token(&text("a"), 10.0).is_some());
    assert!(store.revoke_token(&text("a"), 20.0).is_none());
    store.put(Kind::Refresh,record(r#"{"tokenHash":"r","familyId":"f","grantId":"g","expiresAt":10,"status":"rotated"}"#)).unwrap();
    assert!(matches!(
        store.rotate(&text("r"), text("new"), 10.0, 20.0),
        Rotation::Invalid
    ));
    assert!(
        store
            .get(Kind::Grant, &text("g"))
            .unwrap()
            .attributes
            .get("revokedAt")
            .is_none()
    );
}
#[test]
fn grant_revocation_updates_all_related_refresh_and_access_tokens() {
    let mut store = Store::default();
    store.put(Kind::Grant, record(r#"{"id":"g"}"#)).unwrap();
    store
        .put(Kind::Access, record(r#"{"tokenHash":"a","grantId":"g"}"#))
        .unwrap();
    store
        .put(
            Kind::Refresh,
            record(r#"{"tokenHash":"r","grantId":"g","status":"active"}"#),
        )
        .unwrap();
    store.revoke_grant(&text("g"), 123.0);
    assert_eq!(
        store
            .get(Kind::Access, &text("a"))
            .unwrap()
            .attributes
            .get("revokedAt"),
        Some(&Value::Number(123.0))
    );
    assert_eq!(
        store
            .get(Kind::Refresh, &text("r"))
            .unwrap()
            .attributes
            .get("status"),
        Some(&Value::String(text("revoked")))
    );
}
#[test]
fn refresh_history_shares_immutable_payload_and_releases_it_when_store_drops() {
    let mut store = Store::default();
    let mut initial = record(
        r#"{"tokenHash":"r0","familyId":"f","grantId":"g","expiresAt":10000,"status":"active"}"#,
    );
    initial.payload = vec![7; 65536].into();
    store.put(Kind::Refresh, initial).unwrap();
    let payload = store.get(Kind::Refresh, &text("r0")).unwrap().payload;
    let weak = std::sync::Arc::downgrade(&payload);
    for i in 0..4096 {
        assert!(matches!(
            store.rotate(
                &text(&format!("r{i}")),
                text(&format!("r{}", i + 1)),
                i as f64,
                10000.0
            ),
            Rotation::Rotated(_)
        ));
    }
    let latest = store.get(Kind::Refresh, &text("r4096")).unwrap().payload;
    assert!(std::sync::Arc::ptr_eq(&payload, &latest));
    drop(latest);
    drop(payload);
    drop(store);
    assert!(weak.upgrade().is_none());
}
