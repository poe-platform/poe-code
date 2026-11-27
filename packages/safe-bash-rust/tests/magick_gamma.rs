use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn magick_gamma_corrects_channel_samples_through_shell() {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/sample.ppm",
        b"P3\n3 2\n255\n255 0 0   0 255 0   0 0 255\n0 0 0   128 128 128   255 255 255\n",
    )
    .unwrap();
    let mut shell = Shell::new(
        Arc::new(fs),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    for (gamma, expected) in [
        ("2", "ff000000ff000000ff000000b5b5b5ffffff\n"),
        ("1", "ff000000ff000000ff000000808080ffffff\n"),
        ("0.5", "ff000000ff000000ff000000404040ffffff\n"),
    ] {
        let result = shell
            .exec_with_options(
                &format!(
                    "set -o pipefail; magick sample.ppm -gamma {gamma} -depth 8 rgb:- | xxd -p"
                ),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(result.stdout, expected, "gamma {gamma}");
        assert!(result.stderr.is_empty(), "{result:?}");
        assert!(!result.used_typescript_bridge);
    }
}
