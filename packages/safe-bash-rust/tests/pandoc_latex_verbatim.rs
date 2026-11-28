use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn latex_verbatim_retains_literal_punctuation() {
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
            r#"printf %s 'Use \verb|a_b % x| here.
' | pandoc -f latex -t json | jq -c '[..|objects|select(.t?=="Code")|.c[1]]'"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stderr, "");
    assert_eq!(result.stdout, "[\"a_b % x\"]\n");
}

#[test]
fn latex_verbatim_delimiters_protect_literal_content() {
    for (input, expected) in [
        (r"\verb!a_b % x!", "<p><code>a_b % x</code></p>\n"),
        (r"\verb%a_b%", "<p><code>a_b</code></p>\n"),
        (r"x\verb||y", "<p>x<code></code>y</p>\n"),
        (r"\verb|}|", "<p><code>}</code></p>\n"),
        (r"\verb|a_b % x|% comment", "<p><code>a_b % x</code></p>\n"),
        (r"\verb|`a``b`|", "<p><code>`a``b`</code></p>\n"),
        (r"\verb|  a_b  |", "<p><code>  a_b  </code></p>\n"),
        (r"\verb|  |", "<p><code>  </code></p>\n"),
        (
            r"\verb|\textbf{x} \emph{y} \texttt{z}|",
            "<p><code>\\textbf{x} \\emph{y} \\texttt{z}</code></p>\n",
        ),
        (
            r"Use \verb+é_中 %+ and \verb!x|y!.",
            "<p>Use <code>é_中 %</code> and <code>x|y</code>.</p>\n",
        ),
        (
            r"\textbf{Use \verb|a_b % x| here}",
            "<p><strong>Use <code>a_b % x</code> here</strong></p>\n",
        ),
        (
            r"\section{Use \verb|a_b % x|}",
            "<h1 id=\"use-a_b--x\">Use <code>a_b % x</code></h1>\n",
        ),
        (
            "\\section{Title}\n\nA \\textbf{bold} and \\emph{italic} \\texttt{code}.\ncontinued\n\nNext.",
            "<h1 id=\"title\">Title</h1>\n<p>A <strong>bold</strong> and <em>italic</em> <code>code</code>.\ncontinued</p>\n<p>Next.</p>\n",
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
