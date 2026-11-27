use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn htmlq_preserves_textarea_rcdata() {
    for (input, selector, expected) in [
        (
            "<textarea>one <b>literal</b> &amp; two</textarea>",
            "textarea",
            "one <b>literal</b> & two\n",
        ),
        (
            "<TEXTAREA>é <!--literal--> &lt;b&gt; &#38;amp;</TeXtArEa ><p>after</p>",
            "textarea,p",
            "é <!--literal--> <b> &amp;\nafter\n",
        ),
        (
            "<textarea>a</textarea-extra>b</textarea/><p>after</p>",
            "textarea,p",
            "a</textarea-extra>b\nafter\n",
        ),
        (
            "<textarea>one <b>literal</b> &amp; two",
            "textarea",
            "one <b>literal</b> & two\n",
        ),
        (
            "<textarea><b>literal</b></textarea><b>outside</b>",
            "b",
            "outside\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | htmlq -t '{selector}'"),
                ExecOptions {
                    cwd: Some("/".into()),
                    env: BTreeMap::from([
                        ("LC_ALL".into(), "C".into()),
                        ("TZ".into(), "UTC".into()),
                    ]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}
