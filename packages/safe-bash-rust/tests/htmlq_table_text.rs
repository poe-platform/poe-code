use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn htmlq_fosters_table_text_through_shell() {
    for (input, selector, expected) in [
        (
            "<table>outside<tr><td>inside</td></tr></table>",
            "table",
            "inside\n",
        ),
        (
            "<main>before<table>outside<tr><td>inside</td></tr></table>after</main>",
            "main",
            "beforeoutsideinsideafter\n",
        ),
        (
            "<table>one<tbody>two<tr>three<td>inside</td>four</tr>five</tbody>six</table>",
            "table",
            "inside\n",
        ),
        (
            "<main><table>one<tbody>two<tr>three<td>inside</td>four</tr>five</tbody>six</table></main>",
            "main",
            "onetwothreefourfivesixinside\n",
        ),
        (
            "<table> \t<tr><td>inside</td></tr> </table>",
            "table",
            " \tinside \n",
        ),
        (
            "<table>&nbsp;<tr><td>inside</td></tr></table>",
            "table",
            "inside\n",
        ),
        (
            "<table><caption>caption</caption><tr><td>inside</td></tr>outside",
            "table",
            "captioninside\n",
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
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}: {selector}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
