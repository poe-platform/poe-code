use safe_bash_rust::{ExecOptions, Shell};
use std::collections::BTreeMap;

#[test]
fn magick_unsharp_preserves_amount_and_threshold() {
    for (geometry, expected) in [
        ("0x1+0+0", "282828646464c8c8c8\n"),
        ("0x2+0+0.05", "282828646464c8c8c8\n"),
        ("0x1+1+1", "282828646464c8c8c8\n"),
        ("0x1+1+0", "181818595959e3e3e3\n"),
        ("0x1+0.5+0", "2020205f5f5fd6d6d6\n"),
        ("0x1+1+0.1", "282828646464e3e3e3\n"),
        ("0x1+1", "181818646464e3e3e3\n"),
        ("0x1", "181818646464e3e3e3\n"),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell.exec_with_options(
            &format!("printf %s 'P3\n3 1\n255\n40 40 40  100 100 100  200 200 200\n' > row.ppm\nmagick row.ppm -unsharp {geometry} -depth 8 rgb:out.rgb && xxd -p out.rgb"),
            ExecOptions {
                cwd: Some("/".into()),
                env: BTreeMap::from([("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())]),
                ..Default::default()
            },
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{geometry}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{geometry}");
    }
}
