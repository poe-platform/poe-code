use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn htmlq_excludes_template_fragments_from_document_traversal() {
    for (input, options, expected) in [
        (
            "<template><p>template</p></template><p>visible</p>",
            "-t p",
            "visible\n",
        ),
        (
            "<TEMPLATE><template><p>nested</p></template><p>hidden</p></TEMPLATE><p>visible</p>",
            "-t p",
            "visible\n",
        ),
        (
            "<div>before<template>hidden<p>template</p></template>after</div>",
            "-t div",
            "beforeafter\n",
        ),
        (
            "<div>before<template>hidden<p>template</p></template>after</div>",
            "-tw div",
            "before\nafter\n\n",
        ),
        (
            "<template id=card><p>template</p></template>",
            "template",
            "<template id=\"card\"></template>\n",
        ),
        ("<template><p>template</p></template>", "-t template", "\n"),
        (
            "<template id=card><p>template</p></template>",
            "-a id template:empty",
            "card\n",
        ),
        (
            "<template><base href=https://hidden.test/></template><base href=https://visible.test/><a href=/path>link</a>",
            "-B -a href a",
            "https://visible.test/path\n",
        ),
        (
            "<svg><template><text>visible</text></template></svg>",
            "-t text",
            "visible\n",
        ),
        (
            "<svg><foreignObject><template><p>hidden</p></template><p>visible</p></foreignObject></svg>",
            "-t p",
            "visible\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | htmlq {options}"),
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
        assert_eq!(result.stdout, expected, "{input} ({options})");
        assert_eq!(result.stderr, "", "{input}");
    }
}
