use config_mutations_rust::value::Value;
use frontmatter_rust::parse_document;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
#[test]
fn parser_owns_frontmatter_root_admission_and_duplicate_policy() {
    let source = u("---\ntitle: first\ntitle: second\n---\nBody");
    let parsed = parse_document(&source, false, None);
    assert!(parsed.errors.is_empty());
    assert_eq!(
        parsed.yaml.value.get("title"),
        Some(&Value::String(u("second")))
    );
    assert_eq!(&source[parsed.body_start..], u("Body"));
    let strict = parse_document(&source, true, None);
    assert_eq!(strict.errors[0].message, "Map keys must be unique");
    assert_eq!(strict.errors[0].position, Some((17, 18)));
    for yaml in ["- alpha", "42", "!!timestamp 2026-01-01"] {
        let parsed = parse_document(&u(&format!("---\n{yaml}\n---\nBody")), false, None);
        assert_eq!(
            parsed.errors[0].message,
            "YAML frontmatter must parse to an object."
        );
        assert_eq!(parsed.errors[0].position, None);
    }
}
#[test]
fn parser_returns_delimiter_flow_eof_and_original_offset_diagnostics() {
    let source = u("---\r\ntitle: ok\r\nitems: [broken\r\n---\r\nBody");
    let parsed = parse_document(&source, false, None);
    assert_eq!(parsed.errors[0].position, Some((16, 16)));
    assert!(parsed.errors[0].message.contains("Flow sequence"));
    assert_eq!(&source[parsed.body_start..], u("Body"));
    let source = u("---\ntitle: value");
    let parsed = parse_document(&source, false, None);
    assert_eq!(parsed.errors[0].message, frontmatter_rust::MISSING_END);
    assert_eq!(
        parsed.errors[0].position,
        Some((source.len(), source.len()))
    );
    assert_eq!(parsed.body_start, source.len());
}
#[test]
fn absent_fences_and_null_yaml_return_empty_records_without_rewriting_body() {
    let source = u("\u{feff}# Body\r\nText");
    let parsed = parse_document(&source, false, None);
    assert_eq!(parsed.body_start, 0);
    assert_eq!(parsed.yaml.value, Value::Object(vec![]));
    for source in [
        "---\n---\nBody",
        "---\nnull\n---\nBody",
        "---\rtitle: Example\r---\rBody",
    ] {
        let source = u(source);
        let parsed = parse_document(&source, false, None);
        assert!(parsed.errors.is_empty());
        assert_eq!(&source[parsed.body_start..], u("Body"));
    }
}
