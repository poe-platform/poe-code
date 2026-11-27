use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn composite_preserves_background_pixels_and_canvas_through_shell() {
    for (inputs, options, expected) in [
        (
            "sample.ppm -size 1x1 xc:yellow",
            "-gravity southeast -geometry +0+0",
            "ff000000ff000000ff000000808080ffff00\n",
        ),
        (
            "sample.ppm -size 1x1 xc:yellow",
            "-gravity southeast -geometry +1+1",
            "ff0000ffff000000ff000000808080ffffff\n",
        ),
        (
            "sample.ppm -size 2x1 xc:yellow",
            "-gravity northwest -geometry -1+0",
            "ffff0000ff000000ff000000808080ffffff\n",
        ),
        (
            "-size 3x2 xc:red -size 1x1 xc:yellow",
            "-gravity southeast",
            "ff0000ff0000ff0000ff0000ff0000ffff00\n",
        ),
        (
            "sample.ppm -size 1x1 xc:none",
            "-gravity southeast",
            "ff000000ff000000ff000000808080ffffff\n",
        ),
    ] {
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file(
            "/sample.ppm",
            b"P3\n3 2\n255\n255 0 0   0 255 0   0 0 255\n0 0 0   128 128 128   255 255 255\n",
        )
        .unwrap();
        let mut shell = Shell::new(
            fs,
            ShellOptions {
                cwd: Some("/".into()),
                env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                mode: BackendMode::NativeOnly,
            },
        );
        let command = format!(
            "set -o pipefail; magick {inputs} {options} -composite -depth 8 rgb:- | xxd -p"
        );
        let result = shell
            .exec_with_options(&command, ExecOptions::default())
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{command}");
        assert_eq!(result.stderr, "", "{command}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn composite_command_preserves_sizes_when_reversing_input_order() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..ShellOptions::default()
        },
    );
    let result = shell
        .exec_with_options(
            "set -o pipefail; composite -size 1x1 xc:yellow -size 3x2 xc:red -gravity southeast -depth 8 rgb:- | xxd -p",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "ff0000ff0000ff0000ff0000ff0000ffff00\n");
    assert_eq!(result.stderr, "");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn composite_missing_background_fails_without_output() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..ShellOptions::default()
        },
    );
    let result = shell
        .exec_with_options(
            "magick missing.ppm -size 1x1 xc:yellow -composite -depth 8 rgb:-",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stdout, "");
    assert!(!result.stderr.is_empty());
    assert!(!result.used_typescript_bridge);
}
