use config_extends_rust::document::{Extends, Format, parse_document};
use config_mutations_rust::value::Value;
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn parse(content: &str, extension: &str) {
    let parsed = parse_document(
        &u(content),
        &u(extension),
        &u("/tmp/config"),
        &mut |path| path.first() == Some(&47),
        None,
    )
    .unwrap();
    assert!(matches!(parsed.yaml.value, Value::Object(_)));
}
#[test]
fn document_formats_extensions_bom_and_content_fallbacks_follow_sdk_policy() {
    for (content, extension, format) in [
        ("---\ntitle: Hello\n---\nBody", ".md", Format::Markdown),
        ("title: Hello", ".yaml", Format::Yaml),
        ("{\"title\":\"Hello\"}", ".json", Format::Json),
        (
            "\u{feff}---\rtitle: Hello\r---\rBody",
            ".txt",
            Format::Markdown,
        ),
        ("{\"title\":\"Hello\"}", ".yaml", Format::Yaml),
    ] {
        let parsed = parse_document(
            &u(content),
            &u(extension),
            &u("/tmp/config"),
            &mut |_| false,
            None,
        )
        .unwrap();
        assert_eq!(parsed.format, format);
    }
    parse("# comment only\n", ".yaml");
    parse("null", ".yaml");
}
#[test]
fn markdown_body_overrides_prompt_but_empty_body_preserves_own_prompt() {
    let parse = |source: &str| {
        parse_document(
            &u(source),
            &u(".md"),
            &u("/tmp/config.md"),
            &mut |_| false,
            None,
        )
        .unwrap()
    };
    assert_eq!(
        parse("---\nprompt: from metadata\n---\nBody")
            .yaml
            .value
            .get("prompt"),
        Some(&Value::String(u("Body")))
    );
    assert_eq!(
        parse("---\nprompt: from metadata\n---\n")
            .yaml
            .value
            .get("prompt"),
        Some(&Value::String(u("from metadata")))
    );
    assert_eq!(
        parse("---\ntitle: Hello\n---\n").yaml.value.get("prompt"),
        Some(&Value::String(vec![]))
    );
    assert_eq!(
        parse("---\r# horizontal rule\rBody")
            .yaml
            .value
            .get("prompt"),
        Some(&Value::String(u("---\r# horizontal rule\rBody")))
    );
    assert_eq!(
        parse("Plain\rbody").yaml.value.get("prompt"),
        Some(&Value::String(u("Plain\nbody")))
    );
}
#[test]
fn extends_is_extracted_trimmed_validated_and_never_inherited() {
    for (content, expected, present) in [
        ("title: Hello", Extends::Disabled, false),
        ("extends: false", Extends::Disabled, true),
        ("extends: true", Extends::Enabled, true),
        (
            "extends: ' ./base.md '",
            Extends::Path(u("./base.md")),
            true,
        ),
    ] {
        let parsed = parse_document(
            &u(content),
            &u(".yaml"),
            &u("/tmp/config.yaml"),
            &mut |path| path.first() == Some(&47),
            None,
        )
        .unwrap();
        assert_eq!(parsed.extends, expected);
        assert_eq!(parsed.has_extends, present);
        assert!(parsed.yaml.value.get("extends").is_none());
    }
    for (content, message) in [
        ("extends: 42", "expected a boolean or relative string path."),
        ("extends: ''", "expected a non-empty relative path."),
        ("extends: /tmp/base.md", "expected a relative path."),
    ] {
        let error = parse_document(
            &u(content),
            &u(".yaml"),
            &u("/tmp/config.yaml"),
            &mut |path| path.first() == Some(&47),
            None,
        )
        .unwrap_err();
        assert_eq!(
            String::from_utf16(&error.message).unwrap(),
            format!("Invalid extends value in /tmp/config.yaml: {message}")
        );
    }
}
#[test]
fn removing_overridden_prompt_filters_date_and_symbol_alias_metadata() {
    let parsed = parse_document(
        &u("---\nprompt: &date !!timestamp 2026-01-01\nfirst: *date\nsecond: *date\n---\nBody"),
        &u(".md"),
        &u("/tmp/config.md"),
        &mut |_| false,
        None,
    )
    .unwrap();
    assert_eq!(parsed.yaml.date_ids.len(), 2);
    assert_eq!(parsed.yaml.date_ids[0], parsed.yaml.date_ids[1]);
    for content in ["hello", "- alpha"] {
        assert!(
            parse_document(
                &u(content),
                &u(".yaml"),
                &u("/tmp/config.yaml"),
                &mut |_| false,
                None
            )
            .is_err()
        );
    }
    assert!(
        parse_document(
            &u("[1]"),
            &u(".json"),
            &u("/tmp/config.json"),
            &mut |_| false,
            None
        )
        .is_err()
    );
}

#[test]
fn body_override_preserves_existing_prompt_property_order() {
    let parsed = parse_document(
        &u("---\nprompt: metadata\ntitle: next\n---\nBody"),
        &u(".md"),
        &u("/tmp/config.md"),
        &mut |_| false,
        None,
    )
    .unwrap();
    let Value::Object(fields) = parsed.yaml.value else {
        panic!("Object root")
    };
    assert_eq!(
        fields
            .iter()
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>(),
        vec![u("prompt"), u("title")]
    );
}
