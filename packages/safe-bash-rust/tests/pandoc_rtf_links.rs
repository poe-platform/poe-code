use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_hyperlink_target_reaches_pandoc_json() {
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
            r#"printf %s '{\rtf1\ansi {\field{\*\fldinst HYPERLINK "https://example.org/a"}{\fldrslt Manual}}}' | pandoc -f rtf -t json | jq -c '[..|objects|select(.t?=="Link")|.c[2]]'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "[[\"https://example.org/a\",\"\"]]\n");
}

#[test]
fn rtf_links_preserve_labels_formatting_and_group_scope() {
    for (input, format, expected) in [
        (
            r#"{\rtf1 Before {\field{\*\fldinst HYPERLINK "https://example.org/a"}{\fldrslt Manual {\b bold}}} after {\field{\fldinst HYPERLINK https://example.org/b}{\fldrslt Other}}.}"#,
            "html",
            "<p>Before <a href=\"https://example.org/a\">Manual <strong>bold</strong></a> after <a href=\"https://example.org/b\">Other</a>.</p>\n",
        ),
        (
            r#"{\rtf1 {\field{\*\fldinst HYPERLINK "https://example.org/\u233?\{x\}"}{\fldrslt Caf\u233?}}}"#,
            "html",
            "<p><a href=\"https://example.org/é{x}\">Café</a></p>\n",
        ),
        (
            r#"{\rtf1 A{\field{\*\fldinst HYPERLINK "https://example.org/a"}{\fldrslt Manual}}B}"#,
            "plain",
            "AManualB\n",
        ),
        (
            r#"{\rtf1 A{\*\unknown {\field{\*\fldinst HYPERLINK "secret"}{\fldrslt hidden}}}B}"#,
            "html",
            "<p>AB</p>\n",
        ),
        (
            r#"{\rtf1 A{\field{\*\fldinst DATE}{\fldrslt Today}}B{\fldinst HYPERLINK "secret"}C}"#,
            "html",
            "<p>ATodayBC</p>\n",
        ),
        (
            r#"{\rtf1 {\field{\*\fldinst HYPERLINK "unterminated}{\fldrslt Manual}}}"#,
            "html",
            "<p>Manual</p>\n",
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
                &format!("pandoc -f rtf -t {format}"),
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{input}");
        assert_eq!(result.stdout, expected, "{input}");
    }
}

#[test]
fn unrtf_keeps_field_instructions_out_of_visible_text() {
    for (profile, expected) in [
        ("standards-strict", "Before Manual after"),
        ("gnu-0.21.10", "\n-----------------\nBefore Manual after"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec_with_options(
                &format!("unrtf --text --quiet --profile={profile}"),
                ExecOptions {
                    stdin: Some(r#"{\rtf1 Before {\field{\*\fldinst HYPERLINK "https://example.org/a"}{\fldrslt Manual}} after}"#.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{profile}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{profile}");
        assert_eq!(result.stdout, expected, "{profile}");
    }
}
