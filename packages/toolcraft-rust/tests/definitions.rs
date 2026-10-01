use toolcraft_rust::definitions::{
    Metadata, Source, default_child_issue, merge_metadata, rename_issue, source_location,
};

fn text(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[test]
fn metadata_inherits_overrides_and_retains_secret_order() {
    let parent = Metadata {
        scope: Some(vec![text("mcp")]),
        secrets: vec![text("token"), text("__proto__")],
        approval: true,
        auth: true,
        version: true,
        check: true,
    };
    let own = Metadata {
        scope: Some(vec![]),
        secrets: vec![text("token"), vec![0xd800]],
        approval: true,
        auth: true,
        version: false,
        check: true,
    };
    let plan = merge_metadata(&parent, &own, true);
    assert_eq!(plan.scope, Some(vec![]));
    assert_eq!(plan.approval, Source::Own);
    assert_eq!(plan.auth, Source::Own);
    assert_eq!(plan.version, Source::Parent);
    assert_eq!(plan.check, Source::Both);
    assert_eq!(
        plan.secrets,
        vec![(Source::Own, 0), (Source::Parent, 1), (Source::Own, 1)]
    );
    let empty = Metadata::default();
    assert_eq!(
        merge_metadata(&empty, &empty, true).scope,
        Some(vec![text("cli"), text("sdk")])
    );
    assert_eq!(merge_metadata(&empty, &empty, false).scope, None);
    assert_eq!(
        merge_metadata(&parent, &empty, true).approval,
        Source::Parent
    );
    assert_eq!(merge_metadata(&empty, &empty, true).check, Source::Absent);
}

#[test]
fn rename_and_default_validation_match_definition_errors() {
    assert_eq!(rename_issue(&[text("a.b"), text("x.y")]), None);
    assert_eq!(rename_issue(&[text("")]), Some(("empty", 0, 0)));
    assert_eq!(rename_issue(&[text("a..b")]), Some(("segment", 0, 0)));
    assert_eq!(
        rename_issue(&[text("a"), text("a")]),
        Some(("duplicate", 1, 0))
    );
    assert_eq!(rename_issue(&[vec![0xd800], vec![0xd801]]), None);
    assert_eq!(default_child_issue(-1, &[true]), Some("missing"));
    assert_eq!(default_child_issue(1, &[true, false]), Some("group"));
    assert_eq!(default_child_issue(0, &[true, false]), None);
}

#[test]
fn source_frames_preserve_paths_and_utf16() {
    assert_eq!(
        source_location(&text(" at command (file:///repo/command.ts:10:2)")),
        Some(text("file:///repo/command.ts"))
    );
    assert_eq!(
        source_location(&text(" at /repo/a:b.ts:10:2")),
        Some(text("/repo/a:b.ts"))
    );
    // The reference treats the slash in this Node frame as a path start.
    assert_eq!(
        source_location(&text(" at node:internal/module:1:1")),
        Some(text("/module"))
    );
    assert_eq!(source_location(&text(" at node:events:1:1")), None);
    assert_eq!(
        source_location(&[47, 0xd800, 58, 49, 58, 50]),
        Some(vec![47, 0xd800])
    );
}
