use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_unicode_restores_fallback_counts_after_nested_groups() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
        },
    );
    let result = shell
        .exec_with_options(
            r"printf %s '{\rtf1\ansi A\uc2\u233abB{\uc1\u231x}C\u246zzD}' | pandoc -f rtf -t plain",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "AéBçCöD\n");
}

#[test]
fn rtf_unicode_counts_fallback_tokens_and_preserves_surrounding_text() {
    for (source, expected) in [
        (r"{\rtf1 A\u233?B}", "AéB\n"),
        (r"{\rtf1\uc0 A\u233B{\uc2\u231xyC}D\u246E}", "AéBçCDöE\n"),
        (r"{\rtf1 A\u-255?B}", "A！B\n"),
        (r"{\rtf1 A\u-10179?\u-8704?B}", "A😀B\n"),
        (r"{\rtf1\uc2 A\u233\'61\'62B}", "AéB\n"),
        (r"{\rtf1\uc2 A\u233\{\}B}", "AéB\n"),
        (r"{\rtf1\uc1 A\u233\tab B}", "AéB\n"),
        (r"{\rtf1\uc2 A\u233x{B}C}", "AéBC\n"),
        (r"{\rtf1 A{\b\uc0\u233B}C\u246?D}", "AéBCöD\n"),
        (r"{\rtf1 A{\i\uc0\u233B}C\u246?D}", "AéBCöD\n"),
        (r"{\rtf1 A\uc0\u233\par B}", "Aé\n\nB\n"),
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
                "pandoc -f rtf -t plain",
                ExecOptions {
                    stdin: Some(source.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{source}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{source}");
        assert_eq!(result.stdout, expected, "{source}");
    }
}

#[test]
fn rtf_export_round_trips_accented_prose() {
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
            r#"printf %s 'Résumé, café and Zürich.
' | pandoc -f markdown -t rtf -o a.rtf && pandoc -f rtf -t json a.rtf | jq -c '[..|objects|select(.t?=="Str")|.c]'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(
        result.stdout,
        "[\"Résumé,\",\"café\",\"and\",\"Zürich.\"]\n"
    );
}

#[test]
fn rtf_export_encodes_unicode_and_literal_syntax() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let exported = shell
        .exec_with_options(
            "pandoc -f markdown -t rtf",
            ExecOptions {
                stdin: Some(
                    "# Résumé\n\n**café** *Zürich* `é{\\path}` 中文！ 😀 e\u{301}\n".into(),
                ),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(exported.exit_code, 0, "{}", exported.stderr);
    assert_eq!(exported.stderr, "");
    assert!(exported.stdout.is_ascii(), "{}", exported.stdout);
    let imported = shell
        .exec_with_options(
            "pandoc -f rtf -t plain",
            ExecOptions {
                stdin: Some(exported.stdout),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(imported.exit_code, 0, "{}", imported.stderr);
    assert_eq!(imported.stderr, "");
    assert_eq!(
        imported.stdout,
        "Résumé\n\ncafé Zürich é{\\path} 中文！ 😀 e\u{301}\n"
    );
}
