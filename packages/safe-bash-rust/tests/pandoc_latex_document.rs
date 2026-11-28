use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn latex_document_preamble_is_not_body_text() {
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
            r"printf %s '\documentclass{article}
\usepackage{amsmath}
\begin{document}
Main body.
\end{document}
' | pandoc -f latex -t plain --wrap=none",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "Main body.\n");
}

#[test]
fn latex_document_boundaries_preserve_body_and_fragments() {
    for (input, expected) in [
        (
            r"\documentclass{article}\begin{document}Main body.\end{document}Ignored tail.",
            "<p>Main body.</p>\n",
        ),
        (
            "\\documentclass{article}\n\\begin{document}\n\\section{Title}\n\nA \\textbf{bold} body.\n\nSecond paragraph.\n\\end{document}\n",
            "<h1 id=\"title\">Title</h1>\n<p>A <strong>bold</strong> body.</p>\n<p>Second paragraph.</p>\n",
        ),
        (
            "\\documentclass{article}\n% \\begin{document} fake start\n\\begin{document}\nMain body. % \\end{document} fake end\nStill body.\n\\end{document}",
            "<p>Main body. Still body.</p>\n",
        ),
        (
            "\\documentclass{article}\n\\begin \n{document}Main body.\\end {document}",
            "<p>Main body.</p>\n",
        ),
        (
            r"\documentclass{article}\\begin{document}Ignored.\begin{document}Main body.\end{document}",
            "<p>Main body.</p>\n",
        ),
        (
            r"\documentclass{article}\texttt{\begin{document}}Ignored.\begin{document}Main body.\end{document}",
            "<p>Main body.</p>\n",
        ),
        (
            r"\documentclass{article}\newcommand{\project}{Orchid}\begin{document}The \project{} report.\end{document}",
            "<p>The Orchid report.</p>\n",
        ),
        (r"\begin{document}\end{document}", ""),
        (
            r"Use \verb|\begin{document}| here.",
            "<p>Use <code>\\begin{document}</code> here.</p>\n",
        ),
        (
            r"\begin{document}Use \texttt{\end{document}} here.\end{document}",
            "<p>Use <code>\\end{document}</code> here.</p>\n",
        ),
        (
            r"A \textbf{bold} fragment.",
            "<p>A <strong>bold</strong> fragment.</p>\n",
        ),
        (
            r"\documentclass{article}\begin{document}Use \verb|\end{document}| here.\end{document}",
            "<p>Use <code>\\end{document}</code> here.</p>\n",
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
                "pandoc -f latex -t html",
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
