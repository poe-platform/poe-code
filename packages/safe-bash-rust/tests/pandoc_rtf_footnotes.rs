use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_footnote_body_reaches_pandoc_json() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    let result = shell
        .exec_with_options(
            r#"printf %s '{\rtf1\ansi Body{\footnote Source 1} again}' | pandoc -f rtf -t json | jq -c '[..|objects|select(.t?=="Note")|.c]'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout,
        "[[{\"t\":\"Para\",\"c\":[{\"t\":\"Str\",\"c\":\"Source\"},{\"t\":\"Space\"},{\"t\":\"Str\",\"c\":\"1\"}]}]]\n"
    );
}

#[test]
fn rtf_footnotes_preserve_attachment_and_group_state() {
    for (source, expected) in [
        (
            r"{\rtf1\ansi Body{\footnote Source 1} again}",
            r#"[{"t":"Para","c":[{"t":"Str","c":"Body"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"Source"},{"t":"Space"},{"t":"Str","c":"1"}]}]},{"t":"Space"},{"t":"Str","c":"again"}]}]"#,
        ),
        (
            r"{\rtf1 Before\par A{\footnote First {\b bold}\par Second\line line}B{\footnote \u233?}C\par After}",
            r#"[{"t":"Para","c":[{"t":"Str","c":"Before"}]},{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"First"},{"t":"Space"},{"t":"Strong","c":[{"t":"Str","c":"bold"}]}]},{"t":"Para","c":[{"t":"Str","c":"Second"},{"t":"LineBreak"},{"t":"Str","c":"line"}]}]},{"t":"Str","c":"B"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"é"}]}]},{"t":"Str","c":"C"}]},{"t":"Para","c":[{"t":"Str","c":"After"}]}]"#,
        ),
        (
            r"{\rtf1 A{\footnote \b note}B}",
            r#"[{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Strong","c":[{"t":"Str","c":"note"}]}]}]},{"t":"Str","c":"B"}]}]"#,
        ),
        (
            r"{\rtf1 A{\footnote Visible{\*\unknown hidden}\par}B{\annotation {\footnote secret}}C}",
            r#"[{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"Visible"}]}]},{"t":"Str","c":"B"},{"t":"Str","c":"C"}]}]"#,
        ),
        (
            r"{\rtf1 A {\footnote note }B}",
            r#"[{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Space"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"note"}]}]},{"t":"Str","c":"B"}]}]"#,
        ),
        (
            r#"{\rtf1 A{\footnote {\field{\*\fldinst HYPERLINK "https://example.org"}{\fldrslt source}}}B}"#,
            r#"[{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Link","c":[["",[],[]],[{"t":"Str","c":"source"}],["https://example.org",""]]}]}]},{"t":"Str","c":"B"}]}]"#,
        ),
        (
            r"{\rtf1 A{\footnote}B}",
            r#"[{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Note","c":[]},{"t":"Str","c":"B"}]}]"#,
        ),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let result = shell
            .exec_with_options(
                "pandoc -f rtf -t json | jq -c '.blocks'",
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{source}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{source}");
        assert_eq!(result.stdout, format!("{expected}\n"), "{source}");
    }
}

#[test]
fn rtf_footnote_paragraphs_stay_inside_the_note_in_a_table_cell() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    let result = shell
        .exec_with_options(
            r#"printf %s '{\rtf1\trowd\cellx1000\intbl A{\footnote First\par Second}B\cell\row}' | pandoc -f rtf -t json | jq -c '.blocks[0].c[4][0][3][0][1][0][4]'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout.trim_end(),
        r#"[{"t":"Para","c":[{"t":"Str","c":"A"},{"t":"Note","c":[{"t":"Para","c":[{"t":"Str","c":"First"}]},{"t":"Para","c":[{"t":"Str","c":"Second"}]}]},{"t":"Str","c":"B"}]}]"#
    );
}

#[test]
fn rtf_table_in_a_footnote_stays_inside_the_note() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    let result = shell
        .exec_with_options(
            r#"printf %s '{\rtf1 A{\footnote Note\par\trowd\cellx1000\intbl cell\cell\row}B}' | pandoc -f rtf -t json | jq -c '.blocks[0].c[1].c | map(.t)'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "[\"Para\",\"Table\"]\n");
}
