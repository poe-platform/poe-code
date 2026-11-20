use mcp_protocol_rust::json::{self, Value};
use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

fn blocks(source: &str, format: &str) -> Value {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec_with_options(
            &format!("pandoc -f {format} -t json"),
            ExecOptions {
                stdin: Some(source.into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{format}: {}", result.stderr);
    json::parse(result.stdout.as_bytes(), Default::default())
        .unwrap()
        .get("blocks")
        .unwrap()
        .clone()
}
fn expected(value: &str) -> Value {
    json::parse(value.as_bytes(), Default::default()).unwrap()
}
fn count(value: &Value, tag: &str) -> usize {
    usize::from(value.get("t") == Some(&Value::String(tag.encode_utf16().collect())))
        + match value {
            Value::Array(values) => values.iter().map(|value| count(value, tag)).sum(),
            Value::Object(values) => values.iter().map(|(_, value)| count(value, tag)).sum(),
            _ => 0,
        }
}

#[test]
fn thematic_breaks_interrupt_paragraphs() {
    let expected = expected(
        r#"[{"t":"Para","c":[{"t":"Str","c":"a"}]},{"t":"HorizontalRule"},{"t":"Para","c":[{"t":"Str","c":"b"}]}]"#,
    );
    for format in ["commonmark", "gfm", "markdown"] {
        for rule in ["***", "* * *", "___", "_ _ _", "- - -", "  ***"] {
            assert_eq!(
                blocks(&format!("a\n{rule}\nb\n"), format),
                expected,
                "{format}: {rule}"
            );
        }
    }
}

#[test]
fn container_markers_take_precedence_over_setext_underlines() {
    let quote = expected(
        r#"[{"t":"BlockQuote","c":[{"t":"Para","c":[{"t":"Str","c":"a"}]}]},{"t":"HorizontalRule"}]"#,
    );
    let list = expected(
        r#"[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"a"}]}]]},{"t":"HorizontalRule"}]"#,
    );
    let empty_item = expected(
        r#"[{"t":"BulletList","c":[[{"t":"Plain","c":[{"t":"Str","c":"a"}]}],[],[{"t":"Plain","c":[{"t":"Str","c":"b"}]}]]}]"#,
    );
    for format in ["commonmark", "gfm", "markdown"] {
        assert_eq!(blocks("> a\n---\n", format), quote, "{format}");
        assert_eq!(blocks(">a\n---\n", format), quote, "{format}");
        assert_eq!(blocks("- a\n---\n", format), list, "{format}");
        assert_eq!(blocks("- a\n-\n- b\n", format), empty_item, "{format}");
    }
}

#[test]
fn setext_headings_still_work_inside_containers() {
    for format in ["commonmark", "gfm", "markdown"] {
        for source in ["a\n---\n", "> a\n> ---\n", "- a\n  ---\n"] {
            let actual = blocks(source, format);
            assert_eq!(count(&actual, "Header"), 1, "{format}: {source}");
            assert_eq!(count(&actual, "HorizontalRule"), 0, "{format}: {source}");
            assert_eq!(
                count(&actual, "BulletList"),
                usize::from(source.starts_with('-')),
                "{format}: {source}"
            );
            assert_eq!(
                count(&actual, "BlockQuote"),
                usize::from(source.starts_with('>')),
                "{format}: {source}"
            );
        }
    }
}

#[test]
fn gfm_tables_allow_optional_edge_pipes() {
    let expected = blocks("| a | b |\n| - | - |\n| x | y |\n", "gfm");
    assert_eq!(count(&expected, "Table"), 1);
    for header in ["a | b", "| a | b", "a | b |", "| a | b |"] {
        for delimiter in ["- | -", "| - | -", "- | - |", "| - | - |"] {
            let source = format!("{header}\n{delimiter}\nx | y\n");
            assert_eq!(blocks(&source, "gfm"), expected, "{source}");
        }
    }
    for format in ["commonmark", "gfm-pipe_tables"] {
        assert_eq!(
            count(&blocks("a | b\n- | -\nx | y\n", format), "Table"),
            0,
            "{format}"
        );
    }
}

#[test]
fn optional_pipe_tables_work_inside_quotes_and_lists() {
    let table = blocks("a | b\n- | -\nx | y\n", "gfm");
    assert_eq!(count(&table, "Table"), 1);
    let Value::Array(table) = table else { panic!() };
    let actual = blocks(
        "> a | b\n> - | -\n> x | y\n\n- a | b\n  - | -\n  x | y\n",
        "gfm",
    );
    assert_eq!(count(&actual, "Table"), 2);
    let Value::Array(actual) = actual else {
        panic!()
    };
    assert_eq!(actual[0].get("c"), Some(&Value::Array(table.clone())));
    assert_eq!(
        actual[1].get("c"),
        Some(&Value::Array(vec![Value::Array(table)]))
    );
}

#[test]
fn container_lines_are_not_mistaken_for_table_headers() {
    for source in ["- a | b\n- | -\nx | y\n", "> a | b\n- | -\nx | y\n"] {
        let actual = blocks(source, "gfm");
        assert_eq!(count(&actual, "Table"), 0, "{source}");
        assert_eq!(count(&actual, "BulletList"), 1, "{source}");
    }
}
