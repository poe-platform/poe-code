use mcp_protocol_rust::{
    json::{self, Limits, Value},
    jsonrpc::{self, Id, ParsedMessage, Request, RpcError},
};

fn parse(input: &str) -> ParsedMessage {
    jsonrpc::parse_message(input.as_bytes(), Limits::default())
}

fn units(input: &str) -> Vec<u16> {
    input.encode_utf16().collect()
}

fn failure(id: Id, code: i32, message: &str) -> ParsedMessage {
    ParsedMessage::Error {
        id,
        error: RpcError {
            code,
            message: message.into(),
            data: None,
        },
    }
}

#[test]
fn parses_a_request_with_owned_parameters() {
    assert_eq!(
        parse(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"echo"},"ignored":true}"#
        ),
        ParsedMessage::Request(Request {
            id: Some(Id::Number(7.0)),
            method: units("tools/call"),
            params: Some(Value::Object(vec![(
                units("name"),
                Value::String(units("echo"))
            )])),
        })
    );
}

#[test]
fn distinguishes_missing_id_from_a_legacy_null_request_id() {
    assert_eq!(
        parse(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),
        ParsedMessage::Request(Request {
            id: None,
            method: units("notifications/initialized"),
            params: None
        })
    );
    assert_eq!(
        parse(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#),
        ParsedMessage::Request(Request {
            id: Some(Id::Null),
            method: units("ping"),
            params: None
        })
    );
}

#[test]
fn preserves_legacy_fractional_ids_and_lossless_string_ids() {
    for (wire_id, expected) in [
        ("1.5", Id::Number(1.5)),
        ("9007199254740992", Id::Number(9007199254740992.0)),
        (r#""\ud800""#, Id::String(vec![0xd800])),
        (r#""""#, Id::String(vec![])),
    ] {
        let wire = format!(r#"{{"jsonrpc":"2.0","id":{wire_id},"method":"ping"}}"#);
        let ParsedMessage::Request(request) = parse(&wire) else {
            panic!("valid legacy ID: {wire_id}")
        };
        assert_eq!(request.id, Some(expected));
    }
}

#[test]
fn invalid_json_is_a_parse_error_with_a_null_id() {
    for input in [
        "",
        "{",
        "[1,]",
        r#"{"jsonrpc":"2.0","id":1,"method":"ping",}"#,
    ] {
        assert_eq!(parse(input), failure(Id::Null, -32700, "Parse error"));
    }
}

#[test]
fn non_object_messages_are_invalid_requests_including_batches() {
    for input in ["null", "true", "1", r#""text""#, "[]", "[{}]"] {
        assert_eq!(parse(input), failure(Id::Null, -32600, "Invalid Request"));
    }
}

#[test]
fn invalid_envelopes_recover_the_original_id() {
    for input in [
        r#"{"id":"recover","method":"ping"}"#,
        r#"{"jsonrpc":"1.0","id":"recover","method":"ping"}"#,
        r#"{"jsonrpc":"2.0","id":"recover","method":1}"#,
        r#"{"jsonrpc":"2.0","id":"recover","result":{}}"#,
    ] {
        assert_eq!(
            parse(input),
            failure(Id::String(units("recover")), -32600, "Invalid Request")
        );
    }
}

#[test]
fn present_params_must_be_an_object() {
    for params in ["null", "[]", "false", "1", r#""text""#] {
        let input = format!(r#"{{"jsonrpc":"2.0","id":1.5,"method":"ping","params":{params}}}"#);
        assert_eq!(
            parse(&input),
            failure(Id::Number(1.5), -32600, "Invalid Request")
        );
    }
}

#[test]
fn invalid_legacy_ids_are_not_converted_to_notifications() {
    for id in ["true", "false", "{}", "[]", "1e400"] {
        let input = format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"ping"}}"#);
        assert_eq!(parse(&input), failure(Id::Null, -32600, "Invalid Request"));
    }
}

#[test]
fn modern_requests_reject_null_fractional_and_unsafe_numeric_ids_first() {
    for id in [
        "null",
        "1.5",
        "9007199254740992",
        "-9007199254740992",
        "true",
        "1e400",
    ] {
        let input = format!(
            r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/list","params":{{"_meta":{{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}}}}"#
        );
        assert_eq!(
            parse(&input),
            failure(Id::Null, -32600, "Invalid Request ID")
        );
    }
}

#[test]
fn modern_requests_accept_safe_numeric_ids_and_empty_strings() {
    for id in [
        "0",
        "-1",
        "9007199254740991",
        "-9007199254740991",
        r#""""#,
        r#""1""#,
    ] {
        let input = format!(
            r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/list","params":{{"_meta":{{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}}}}"#
        );
        assert!(
            matches!(
                parse(&input),
                ParsedMessage::Request(Request { id: Some(_), .. })
            ),
            "{id}"
        );
    }
}

#[test]
fn serializes_successful_responses_with_the_supplied_result() {
    assert_eq!(
        jsonrpc::format_success_response(
            Id::String(units("call-1")),
            Value::Object(vec![(units("tools"), Value::Array(vec![]))])
        ),
        r#"{"jsonrpc":"2.0","id":"call-1","result":{"tools":[]}}"#
    );
}

#[test]
fn serializes_error_data_and_omits_only_absent_data() {
    assert_eq!(
        jsonrpc::format_error_response(
            Id::Null,
            RpcError {
                code: -32600,
                message: "Invalid Request".into(),
                data: None
            }
        ),
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}"#
    );
    let output = jsonrpc::format_error_response(
        Id::Number(0.0),
        RpcError {
            code: -32602,
            message: "Invalid parameters".into(),
            data: Some(Value::Null),
        },
    );
    assert_eq!(
        json::parse(output.as_bytes(), Limits::default()).unwrap(),
        json::parse(br#"{"jsonrpc":"2.0","id":0,"error":{"code":-32602,"message":"Invalid parameters","data":null}}"#, Limits::default()).unwrap()
    );
}
