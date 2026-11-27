use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn htmlq_ends_paragraph_before_block() {
    for (input, selector, expected) in [
        ("<p>first<div>second</div>end", "p", "first\n"),
        ("<p>first<div>second</div>end", "div", "second\n"),
        ("<p>first<section>second</section>end", "p", "first\n"),
        ("<p>first<h2>second</h2>end", "p", "first\n"),
        ("<p>first<ul><li>second</li></ul>end", "p", "first\n"),
        ("<p>first<pre>second</pre>end", "p", "first\n"),
        ("<p>first<hr>second", "p", "first\n"),
        ("<P>first<DIV>second</DIV>end", "p", "first\n"),
        (
            "<p>first<span>inline</span><div>second</div>end",
            "p",
            "firstinline\n",
        ),
        ("<p>first<p>second", "p", "first\nsecond\n"),
        ("<p>first<span>inline</span>end", "p", "firstinlineend\n"),
        ("<p>first<br>second", "p", "firstsecond\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | htmlq -t {selector}"),
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
        assert_eq!(result.stdout, expected, "{input} ({selector})");
        assert_eq!(result.stderr, "", "{input}");
    }
}
