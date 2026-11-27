use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_preserves_colons_in_quoted_mapping_keys() {
    for (input, expected) in [
        ("\"api:v2\": 4\n", "{\"api:v2\":4}\n"),
        ("'api:v2': 4\n", "{\"api:v2\":4}\n"),
        ("\"api:v2\": \"ready\"\n", "{\"api:v2\":\"ready\"}\n"),
        ("'api:v2': 'ready'\n", "{\"api:v2\":\"ready\"}\n"),
        (
            "parent:\n  \"api:v2\": 4\n",
            "{\"parent\":{\"api:v2\":4}}\n",
        ),
        ("- \"api:v2\": 4\n", "[{\"api:v2\":4}]\n"),
        ("- 'api:v2': 4\n", "[{\"api:v2\":4}]\n"),
        ("inline: {\"api:v2\": 4}\n", "{\"inline\":{\"api:v2\":4}}\n"),
        ("inline: {'api:v2': 4}\n", "{\"inline\":{\"api:v2\":4}}\n"),
        (
            "'api:v2': &api\n  version: 4\ncopy: *api\n",
            "{\"api:v2\":{\"version\":4},\"copy\":{\"version\":4}}\n",
        ),
        ("\"日本:api:v2\": 4\n", "{\"日本:api:v2\":4}\n"),
        (
            "\"api:v2\": >\n  first\n\n  second\n",
            "{\"api:v2\":\"first\\nsecond\\n\"}\n",
        ),
        (
            "'api:v2': |\n  # content\n\n  next\n",
            "{\"api:v2\":\"# content\\n\\nnext\\n\"}\n",
        ),
        ("plain: 4\n", "{\"plain\":4}\n"),
        ("\"api:v2\"\n", "\"api:v2\"\n"),
        ("'api:v2'\n", "\"api:v2\"\n"),
        ("- 'api:v2'\n", "[\"api:v2\"]\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!(
                    "printf %s '{}' | yq -I 0 -p=yaml -o=json .",
                    input.replace('\'', "'\\''")
                ),
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
