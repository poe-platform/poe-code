use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn latex_decodes_accents_in_names_through_the_shell() {
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
            r#"printf %s 'Garc\'"'"'ia met Fran\c{c}ois.
' | pandoc -f latex -t plain --wrap=none"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "García met François.\n");
}

#[test]
fn latex_accents_preserve_surrounding_text_and_inline_structure() {
    for (input, expected) in [
        (
            r"Garc\'{i}a met Fran\c cois.",
            "<p>García met François.</p>\n",
        ),
        (
            r"\'Ecole, \c{C}elik, Andr\'e.",
            "<p>École, Çelik, André.</p>\n",
        ),
        (
            r"\textbf{Garc\'ia} met \emph{Fran\c{c}ois}.",
            "<p><strong>García</strong> met <em>François</em>.</p>\n",
        ),
        (
            r"\verb|Garc\'ia Fran\c{c}ois| and Garc\'ia.",
            "<p><code>Garc\\'ia Fran\\c{c}ois</code> and García.</p>\n",
        ),
        (
            r"Before \'{x} and \c{x} after.",
            "<p>Before x\u{301} and x\u{327} after.</p>\n",
        ),
    ] {
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
                "pandoc -f latex -t html --wrap=none",
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
