use mcp_protocol_rust::json;
use terminal_png_rust::publication::{Publication, validate};
fn v(s: &str) -> json::Value {
    json::parse_utf16(&s.encode_utf16().collect::<Vec<_>>(), Default::default()).unwrap()
}
#[test]
fn option_validation_precedes_publication() {
    for input in [
        r#"{"padding":-1}"#,
        r#"{"padding":1.5}"#,
        r#"{"padding":{"nativeNonFinite":true}}"#,
    ] {
        assert_eq!(
            validate(&v(input)).unwrap_err(),
            "Padding must be a non-negative integer."
        );
    }
    assert_eq!(
        validate(&v(r#"{"output":""}"#)).unwrap_err(),
        "Output path must not be empty."
    );
    assert!(validate(&v(r#"{"padding":0}"#)).is_ok());
}
#[test]
fn temporary_output_is_published_or_cleaned_without_removing_collisions() {
    let mut state = Publication::new(
        &"image.png".encode_utf16().collect::<Vec<_>>(),
        &"entropy".encode_utf16().collect::<Vec<_>>(),
    );
    assert_eq!(
        String::from_utf16_lossy(state.temporary_path()),
        "image.png.entropy.tmp"
    );
    assert!(!state.cleanup(true, true, "EEXIST"));
    assert!(state.cleanup(true, false, "EEXIST"));
    assert!(state.cleanup(false, true, "EEXIST"));
    state.written();
    assert!(state.cleanup(true, true, "EEXIST"));
}
