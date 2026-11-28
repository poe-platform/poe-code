use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_hidden_text_does_not_reach_pandoc_json() {
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
            r#"printf %s '{\rtf1\ansi Public {\v draft text} ending}' | pandoc -f rtf -t json | jq -c '[..|objects|select(.t?=="Str")|.c]'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "[\"Public\",\"ending\"]\n");
}

#[test]
fn rtf_visibility_follows_character_formatting_and_group_scope() {
    for (input, expected) in [
        (
            r"{\rtf1 Public \v draft text\v0 ending}",
            "<p>Public ending</p>\n",
        ),
        (r"{\rtf1 A{\v hidden {\b nested} more}B}", "<p>AB</p>\n"),
        (
            r"{\rtf1 A{\v hidden{\v0 visible}hidden}B}",
            "<p>AvisibleB</p>\n",
        ),
        (
            r"{\rtf1 A{\v1 hidden\plain visible}B}",
            "<p>AvisibleB</p>\n",
        ),
        (
            r"{\rtf1 {\b A{\v hidden}B}C}",
            "<p><strong>A</strong><strong>B</strong>C</p>\n",
        ),
        (
            r"{\rtf1 A{\v hidden\par more\line text\tab\u233?\emdash\{\}}B}",
            "<p>AB</p>\n",
        ),
        (r"{\rtf1\v hidden}", ""),
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
                "pandoc -f rtf -t html",
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
