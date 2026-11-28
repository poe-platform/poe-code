use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn latex_sections_preserve_formatted_titles_and_following_paragraphs() {
    for (input, expected) in [
        (
            "\\section{Sales \\emph{overview}}\n\nBody.\n",
            "[[\"Sales\",\"overview\"]]\n",
        ),
        (
            "\\subsection{Sales \\textbf{overview}}\n\nBody.\n",
            "[[\"Sales\",\"overview\"]]\n",
        ),
        (
            "\\section{Sales \\emph{overview}} Body.\n",
            "[[\"Sales\",\"overview\"]]\n",
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
        for (query, expected) in [
            (
                "[..|objects|select(.t?==\"Header\")|[..|objects|select(.t?==\"Str\")|.c]]",
                expected,
            ),
            (
                "[..|objects|select(.t?==\"Para\")|[..|objects|select(.t?==\"Str\")|.c]]",
                "[[\"Body.\"]]\n",
            ),
            (
                "[..|objects|select(.t?==\"Emph\" or .t?==\"Strong\")|[..|objects|select(.t?==\"Str\")|.c]]",
                "[[\"overview\"]]\n",
            ),
        ] {
            let script = format!("printf %s '{input}' | pandoc -f latex -t json | jq -c '{query}'");
            let result = shell
                .exec_with_options(&script, ExecOptions::default())
                .unwrap();
            assert_eq!(result.exit_code, 0, "{script}: {}", result.stderr);
            assert_eq!(result.stderr, "", "{script}");
            assert_eq!(result.stdout, expected, "{script}");
        }
    }
}
