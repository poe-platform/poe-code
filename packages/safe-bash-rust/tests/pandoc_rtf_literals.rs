use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rtf_body_preserves_literal_markdown_punctuation() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
        },
    );
    for (source, target, expected) in [
        (
            r"{\rtf1\ansi # Issue 17: use *literally* here}",
            "plain",
            "# Issue 17: use *literally* here\n",
        ),
        (
            r"{\rtf1\ansi # Issue 17: use *literally* here}",
            "html",
            "<p># Issue 17: use *literally* here</p>\n",
        ),
        (
            r"{\rtf1\ansi - item\par [label](url) `code` _word_ &amp; <tag>}",
            "plain",
            "- item\n\n[label](url) `code` _word_ &amp; <tag>\n",
        ),
        (
            r"{\rtf1\ansi {\b *literal*} and {\i _literal_}}",
            "html",
            "<p><strong>*literal*</strong> and <em>_literal_</em></p>\n",
        ),
        (
            r"{\rtf1\ansi \b *bold*\b0  and \i _italic_\i0 \par # next\line > line}",
            "html",
            "<p><strong>*bold*</strong> and <em>_italic_</em></p>\n<p># next<br>&gt; line</p>\n",
        ),
        (
            r"{\rtf1\ansi \u35? \u42?word\u42? \{braces\} \\path}",
            "plain",
            "# *word* {braces} \\path\n",
        ),
    ] {
        let result = shell
            .exec_with_options(
                &format!("printf %s '{source}' | pandoc -f rtf -t {target}"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{source}: {}", result.stderr);
        assert_eq!(result.stderr, "", "{source}");
        assert_eq!(result.stdout, expected, "{source} -> {target}");
    }
}
