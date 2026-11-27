use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn htmlq_language_attribute_matching_through_shell() {
    let html = r#"<main id="top"><article id="one" class="entry older" lang="en-US"><b>A</b>1</article>gap<article id="two" class="entry" lang="EN"><b>B</b>2</article><aside>skip</aside><article id="three" class="entry next" data-key="HELLO world">C</article></main>"#;
    for (input, selector, expected) in [
        (html, "article.entry[lang|=en]", "A1\nB2\n"),
        (html, "article[LANG|=EN]", "A1\nB2\n"),
        (html, "article[lang|=\"en\" i]", "A1\nB2\n"),
        (html, "article[lang|=\"en\" s]", "A1\n"),
        (html, "article[lang|=en s]", "A1\n"),
        (html, "article[lang=\"en\"]", "B2\n"),
        (html, "article[data-key|=hello]", ""),
        (html, "article[data-key~=hello i]", "C\n"),
        (
            "<p lang=EN-gb>A</p><p lang=eng>B</p><p lang=fr>C</p><p>D</p>",
            "[lang|=en]",
            "A\n",
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
                &format!("printf %s '{input}' | htmlq -t '{selector}'"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{selector}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{selector}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
