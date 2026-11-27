use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn yq_toml_comments_preserve_value_types_through_shell() {
    for (input, expected) in [
        ("enabled=true # carried over\n", "{\"enabled\":true}\n"),
        (
            "enabled=false# comment\ncount=42 # count\nratio=1.5 # ratio",
            "{\"enabled\":false,\"count\":42,\"ratio\":1.5}\n",
        ),
        (
            "# header\n[feature] # section\nenabled=true # value",
            "{\"feature\":{\"enabled\":true}}\n",
        ),
        (
            "[[features]] # section\nenabled=false # value",
            "{\"features\":[{\"enabled\":false}]}\n",
        ),
        (r##"text="a#b" # comment"##, "{\"text\":\"a#b\"}\n"),
        ("text='a\\#b' # comment", "{\"text\":\"a\\\\#b\"}\n"),
        (r##"text="a\"#b" # comment"##, "{\"text\":\"a\\\"#b\"}\n"),
        (r##"text="a\\" # comment"##, "{\"text\":\"a\\\\\"}\n"),
        (
            r##"values=[true, 2, "#"] # comment"##,
            "{\"values\":[true,2,\"#\"]}\n",
        ),
        (
            r##"value={enabled=true, text="#"} # comment"##,
            "{\"value\":{\"enabled\":true,\"text\":\"#\"}}\n",
        ),
        ("\"hash#key\"=true # comment", "{\"hash#key\":true}\n"),
    ] {
        let mut shell = Shell::new(
            Arc::new(MemoryVfs::new()),
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let quoted = input.replace('\'', "'\\''");
        let result = shell
            .exec_with_options(
                &format!("printf %s '{quoted}' | yq -I 0 -p=toml -o=json ."),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
