use mcp_protocol_rust::json::{self, Limits, Value};
use tiny_stdio_mcp_server_rust::uri_template::UriTemplate;

fn value(source: &str) -> Value {
    json::parse(source.as_bytes(), Limits::default()).unwrap()
}
fn units(source: &str) -> Vec<u16> {
    source.encode_utf16().collect()
}

#[test]
fn uri_templates_expand_scalars_lists_objects_and_unicode_prefixes() {
    for (template, variables, expected) in [
        (
            "https://example.test{/path}{?query}",
            r#"{"path":"a/b","query":"URI Templates"}"#,
            "https://example.test/a%2Fb?query=URI%20Templates",
        ),
        (
            "{+path}{#section}",
            r#"{"path":"/docs/start","section":"a b"}"#,
            "/docs/start#a%20b",
        ),
        ("{?list*}", r#"{"list":["a","b c"]}"#, "?list=a&list=b%20c"),
        ("{;keys*}", r#"{"keys":{"a":"1","b":"2"}}"#, ";a=1;b=2"),
        ("{name:1}", r#"{"name":"🦀hello"}"#, "%F0%9F%A6%80"),
        ("{empty}{?missing}", r#"{"empty":"","missing":null}"#, ""),
        ("{+encoded}", r#"{"encoded":"%2f"}"#, "%2f"),
    ] {
        assert_eq!(
            UriTemplate::parse(&units(template))
                .unwrap()
                .expand(&value(variables))
                .unwrap(),
            units(expected)
        );
    }
}

#[test]
fn template_matches_preserve_literals_operator_boundaries_and_percent_decoding() {
    for (template, uri, expected) in [
        (
            "memo://{name}",
            "memo://quarterly%20report",
            r#"{"name":"quarterly report"}"#,
        ),
        (
            "search://{?query,limit}",
            "search://?query=URI%20Templates&limit=20",
            r#"{"query":"URI Templates","limit":"20"}"#,
        ),
        (
            "https://example.test/{+path}{#section}",
            "https://example.test/docs/start#usage",
            r#"{"path":"docs/start","section":"usage"}"#,
        ),
        ("memo://{name}", "memo://bad%FF", r#"{"name":"bad%FF"}"#),
    ] {
        assert_eq!(
            UriTemplate::parse(&units(template))
                .unwrap()
                .match_uri(&units(uri))
                .unwrap(),
            Some(value(expected))
        );
    }
    assert_eq!(
        UriTemplate::parse(&units("memo://items{/id}"))
            .unwrap()
            .match_uri(&units("memo://other/42"))
            .unwrap(),
        None
    );
}

#[test]
fn malformed_templates_and_prefixes_on_composites_fail_explicitly() {
    for source in [
        "{",
        "}",
        "{}",
        "{x:0}",
        "{x:10000}",
        "{x:3*}",
        "{=x}",
        "{a..b}",
        "{x,{y}}",
    ] {
        assert!(UriTemplate::parse(&units(source)).is_err(), "{source}");
    }
    let template = UriTemplate::parse(&units("{list:2}")).unwrap();
    assert!(template.expand(&value(r#"{"list":["a","b"]}"#)).is_err());
}

#[test]
fn ambiguous_template_matching_and_expansion_are_bounded() {
    let template = UriTemplate::parse(&units("{x}{y}{z}/missing")).unwrap();
    assert_eq!(
        template
            .match_uri(&vec![u16::from(b'a'); 1_500])
            .unwrap_err(),
        "URI template matching resource limit exceeded"
    );
    let template = UriTemplate::parse(&units("{x}")).unwrap();
    let variables = Value::Object(vec![(
        units("x"),
        Value::String(vec![u16::from(b'a'); 1_048_577]),
    )]);
    assert_eq!(
        template.expand(&variables).unwrap_err(),
        "URI template expansion resource limit exceeded"
    );
}
