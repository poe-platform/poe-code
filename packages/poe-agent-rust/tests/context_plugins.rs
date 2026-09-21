use poe_agent_rust::context_plugins::{
    CompactionTail, MemoryLoading, format_compaction_summary, normalize_lines, parse_import_path,
    render_file_awareness,
};
fn utf(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn memory_import_scanner_distinguishes_handles_and_ecmascript_whitespace() {
    for value in ["@handle", "@name with spaces", "@", "@foo\u{FEFF}/bar"] {
        assert_eq!(parse_import_path(&utf(value)), None);
    }
    for (line, path) in [
        (" \u{FEFF}@ ./guide.md\u{FEFF}", "./guide.md"),
        ("@../up.md", "../up.md"),
        ("@folder/file.md", "folder/file.md"),
        ("@folder\\file.md", "folder\\file.md"),
    ] {
        assert_eq!(parse_import_path(&utf(line)), Some(utf(path)));
    }
    assert_eq!(
        normalize_lines(&utf("a\r\nb\rc\n")),
        vec![utf("a"), utf("b\rc"), vec![]]
    );
    let mut state = MemoryLoading::default();
    assert!(state.enter(utf("/root")));
    assert!(!state.enter(utf("/root")));
    state.leave(&utf("/root"));
    assert!(state.enter(utf("/root")));
}
#[test]
fn compaction_tail_counts_user_turns_without_changing_zero_nan_or_fractional_semantics() {
    let mut tail = CompactionTail::new(2.0);
    assert!(!tail.visit_user());
    assert!(tail.visit_user());
    for limit in [0.0, -1.0, 0.5, f64::NAN, f64::INFINITY] {
        assert!(!CompactionTail::new(limit).visit_user());
    }
    assert_eq!(
        format_compaction_summary(&[0xD800]),
        [utf("Compacted context summary:\n"), vec![0xD800]].concat()
    );
    assert_eq!(
        render_file_awareness(vec![utf("z"), utf("a")], vec![utf("b")]),
        utf("Files read before compaction:\n- a\n- z\nFiles modified before compaction:\n- b")
    );
}
