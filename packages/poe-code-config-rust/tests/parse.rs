use mcp_protocol_rust::json::Value;
use poe_code_config_rust::stored::parse;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn filters_empty_scopes_preserves_last_duplicate_and_literal_keys() {
    let data=parse(&u(r#"{"empty":{},"list":[],"null":null,"core":{"__proto__":1,"value":1,"value":2,"10":"x","2":"y"}}"#)).unwrap();
    let Value::Object(scopes) = data else {
        panic!()
    };
    assert_eq!(scopes.len(), 1);
    assert_eq!(scopes[0].0, u("core"));
    let Value::Object(fields) = &scopes[0].1 else {
        panic!()
    };
    assert_eq!(
        fields.iter().find(|(key, _)| *key == u("value")).unwrap().1,
        Value::Number(2.0)
    );
    assert_eq!(
        fields
            .iter()
            .find(|(key, _)| *key == u("__proto__"))
            .unwrap()
            .1,
        Value::Number(1.0)
    );
}
#[test]
fn preserves_utf16_signed_zero_and_json_overflow() {
    let Value::Object(scopes) =
        parse(&u(r#"{"core":{"s":"\ud800","n":-0,"huge":1e400}}"#)).unwrap()
    else {
        panic!()
    };
    let Value::Object(fields) = &scopes[0].1 else {
        panic!()
    };
    assert_eq!(fields[0].1, Value::String(vec![0xd800]));
    let Value::Number(n) = fields[1].1 else {
        panic!()
    };
    assert!(n.is_sign_negative());
    assert_eq!(fields[2].1, Value::Number(f64::INFINITY));
    assert!(parse(&u("{bad}")).is_none());
}
