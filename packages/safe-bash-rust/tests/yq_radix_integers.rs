use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn yq_exports_yaml_hex_and_octal_integers_as_json_numbers() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec_with_options(
            "printf %s 'offset: 0x20\nmode: 0o755\n' | yq -I 0 -p=yaml -o=json .",
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "{\"offset\":32,\"mode\":493}\n");
    assert_eq!(result.stderr, "");
}

#[test]
fn yq_decodes_radix_integers_in_collections_and_aliases_without_losing_precision() {
    for (input, expected) in [
        (
            "[0x0, 0xFF, 0Xff, 0xFF_FF, 0o0, 0o7_55, 0x20000000000001, 0o400000000000000001]",
            "[0,255,255,65535,0,493,9007199254740993,9007199254740993]\n",
        ),
        (
            "offset: &offset 0x20\ncopy: *offset\nnested: {mode: 0o755}",
            "{\"offset\":32,\"copy\":32,\"nested\":{\"mode\":493}}\n",
        ),
        (
            "['0x20', \"0o755\", 0x, 0o8, 0xGG, 0x+20, 0x-20, 0x_+20, 0x10000000000000000, 32, -32, 1.5]",
            "[\"0x20\",\"0o755\",\"0x\",\"0o8\",\"0xGG\",\"0x+20\",\"0x-20\",\"0x_+20\",\"0x10000000000000000\",32,-32,1.5]\n",
        ),
        ("0x20", "32\n"),
        ("0o755", "493\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                "yq -I 0 -p=yaml -o=json .",
                ExecOptions {
                    stdin: Some(input.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input}");
        assert_eq!(result.stderr, "", "{input}");
    }
}
