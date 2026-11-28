use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn latex_expands_document_local_text_macro_through_shell() {
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
            r#"printf %s '\newcommand{\project}{Orchid}The \project{} report.
' | pandoc -f latex -t plain --wrap=none"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "The Orchid report.\n");
}

#[test]
fn latex_macros_preserve_document_structure_and_literal_code() {
    for (input, expected) in [
        (
            r"\newcommand{\project}{Orchid}\project{} and \project{}.",
            "<p>Orchid and Orchid.</p>\n",
        ),
        (
            "\\newcommand{\\project}{Orchid}\n\\section{The \\project{} report}\n\\textbf{\\project{}}.",
            "<h1 id=\"the-orchid-report\">The Orchid report</h1>\n<p><strong>Orchid</strong>.</p>\n",
        ),
        (
            r"\newcommand{\project}{\emph{Orchid}}The \project{} report.",
            "<p>The <em>Orchid</em> report.</p>\n",
        ),
        (
            "\\newcommand{\\project}\n{Orchid}\nThe \\project{} report.",
            "<p>The Orchid report.</p>\n",
        ),
        (
            r"\newcommand{\project}{Orchid}\verb|\project{}| and \project{}.",
            "<p><code>\\project{}</code> and Orchid.</p>\n",
        ),
        (
            r"\verb|\newcommand{\project}{Orchid}|",
            "<p><code>\\newcommand{\\project}{Orchid}</code></p>\n",
        ),
        (
            r"\newcommand{\project}{\name}\newcommand{\name}{Orchid}The \project{} report.",
            "<p>The Orchid report.</p>\n",
        ),
        (
            r"\newcommand{\project}{Orchid}\project report, \project{} report.",
            "<p>Orchidreport, Orchid report.</p>\n",
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

#[test]
fn latex_macro_definitions_do_not_leak_between_invocations() {
    let mut shell = Shell::new(Arc::new(MemoryVfs::new()), ShellOptions::default());
    for (input, expected) in [
        (r"\newcommand{\project}{Orchid}\project{}", "Orchid\n"),
        (r"\project{}", "\\project\n"),
    ] {
        let result = shell
            .exec_with_options(
                "pandoc -f latex -t plain --wrap=none",
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected);
    }
}

#[test]
fn latex_rejects_recursive_macro_expansion() {
    let mut shell = Shell::new(Arc::new(MemoryVfs::new()), ShellOptions::default());
    let result = shell
        .exec_with_options(
            "pandoc -f latex -t plain --wrap=none",
            ExecOptions {
                stdin: Some(r"\newcommand{\project}{\project}\project{}".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(result.stdout, "");
}
