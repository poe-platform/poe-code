use document_ast_rust::resolve_fragment;
use std::borrow::Cow;

#[test]
fn exact_ids_win_without_allocation_or_url_reserialization() {
    for source in ["caf%C3%A9", "café", "part%20two", "bad%FF", "a+b", ""] {
        assert!(
            matches!(resolve_fragment(source, |id| id == source), Some(Cow::Borrowed(id)) if id == source)
        );
    }
    let ids = ["café", "caf%C3%A9"];
    assert_eq!(
        resolve_fragment("caf%C3%A9", |id| ids.contains(&id)).as_deref(),
        Some("caf%C3%A9")
    );
    assert_eq!(
        resolve_fragment("café", |id| ids.contains(&id)).as_deref(),
        Some("café")
    );
}

#[test]
fn fragment_decoding_matches_url_bytes_and_utf8_replacement_once() {
    for (source, target) in [
        ("caf%C3%A9", "café"),
        ("caf%c3%a9", "café"),
        ("part%2520two", "part%20two"),
        ("a%23b", "a#b"),
        ("caf%C3%A9%zz", "café%zz"),
        ("bad%GG%20tail%", "bad%GG tail%"),
        ("bad%FF", "bad�"),
        ("%C3%28", "�("),
        ("%F0%9F", "�"),
        ("%EF%BB%BFtarget", "\u{feff}target"),
        ("a%2Bb", "a+b"),
        ("café%20tail", "café tail"),
        ("%00", "\0"),
    ] {
        assert_eq!(
            resolve_fragment(source, |id| id == target).as_deref(),
            Some(target),
            "{source}"
        );
    }
}

#[test]
fn missing_targets_do_not_trigger_plus_conversion_or_recursive_decoding() {
    assert!(resolve_fragment("part%2520two", |id| id == "part two").is_none());
    assert!(resolve_fragment("a+b", |id| id == "a b").is_none());
    assert!(resolve_fragment("bad%zz", |id| id == "bad").is_none());
    assert!(resolve_fragment("missing%20target", |_| false).is_none());
    assert!(resolve_fragment("e%CC%81", |id| id == "é").is_none());
}
