use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn htmlq_keeps_options_separate_with_omitted_end_tags() {
    for (input, selector, expected) in [
        ("<select><option>A<option>B</select>", "option", "A\nB\n"),
        (
            "<select><option>A<option>B</select>",
            "select > option",
            "A\nB\n",
        ),
        (
            "<select><option>A</option><option>B</option></select>",
            "option",
            "A\nB\n",
        ),
        ("<SELECT><OPTION>A<OPTION>B</SELECT>", "option", "A\nB\n"),
        (
            "<datalist><option>A<option>B</datalist>",
            "option",
            "A\nB\n",
        ),
        (
            "<select><option>A<option>B</select><p>after</p>",
            "option",
            "A\nB\n",
        ),
        (
            "<select><optgroup label=one><option>A<optgroup label=two><option>B</select>",
            "select > optgroup > option",
            "A\nB\n",
        ),
        (
            "<select><optgroup><option>A</optgroup><option>B</select>",
            "select > option",
            "B\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("printf %s '{input}' | htmlq -t \"{selector}\""),
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
