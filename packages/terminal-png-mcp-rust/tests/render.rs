use mcp_protocol_rust::json::{self, Value};
use terminal_png_mcp_rust::{cli, definition, render};
fn parse(text: &str) -> Value {
    json::parse_utf16(&text.encode_utf16().collect::<Vec<_>>(), Default::default()).unwrap()
}
#[test]
fn schema_and_render_are_portable() {
    let definition = definition();
    assert!(
        definition
            .get("inputSchema")
            .unwrap()
            .get("properties")
            .unwrap()
            .get("padding")
            .unwrap()
            .get("minimum")
            == Some(&Value::Number(0.0))
    );
    let png = render(&parse(
        r#"{"ansiText":"Hello │ é","padding":0,"window":false}"#,
    ))
    .unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert!(u32::from_be_bytes(png[16..20].try_into().unwrap()) > 100);
}
#[test]
fn malformed_render_arguments_fail_before_work() {
    for text in [
        "null",
        "{}",
        r#"{"ansiText":42}"#,
        r#"{"ansiText":"x","padding":-1}"#,
        r#"{"ansiText":"x","padding":1.5}"#,
        r#"{"ansiText":"x","window":"false"}"#,
    ] {
        assert!(render(&parse(text)).is_err(), "{text}");
    }
    assert!(render(&parse(r#"{"ansiText":"","padding":10000000}"#)).is_err());
}
#[test]
fn cli_rejects_unknowns_and_positionals() {
    assert_eq!(cli(&["--help".into()]), Ok(true));
    assert_eq!(cli(&["-h".into()]), Ok(true));
    assert_eq!(cli(&[]), Ok(false));
    for args in [
        vec!["--http".into()],
        vec!["input".into()],
        vec!["--help=true".into()],
    ] {
        assert!(cli(&args).is_err());
    }
    assert_eq!(cli(&["--".into()]), Ok(false));
}
