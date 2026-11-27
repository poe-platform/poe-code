use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn rec709_luminance_converts_srgb_pixels_to_linear_grayscale() {
    for (options, format, expected) in [
        (
            "-grayscale Rec709Luminance",
            "rgb",
            "363636b6b6b6121212000000373737ffffff\n",
        ),
        (
            "-grayscale rec709luminance",
            "rgb",
            "363636b6b6b6121212000000373737ffffff\n",
        ),
        (
            "-transparent red -grayscale Rec709Luminance",
            "rgba",
            "36363600b6b6b6ff121212ff000000ff373737ffffffffff\n",
        ),
        (
            "-grayscale Rec709Luminance -negate",
            "rgb",
            "c9c9c9494949edededffffffc8c8c8000000\n",
        ),
        (
            "-grayscale Rec709Luminance -grayscale Rec709Luminance",
            "rgb",
            "363636b6b6b6121212000000373737ffffff\n",
        ),
        (
            "-grayscale Rec709Luma -grayscale Rec709Luminance",
            "rgb",
            "363636b6b6b6121212000000808080ffffff\n",
        ),
        (
            "-grayscale Rec709Luma",
            "rgb",
            "363636b6b6b6121212000000808080ffffff\n",
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
        let result = shell
            .exec_with_options(
                &format!(
                    "set -o pipefail; magick sample.ppm {options} -depth 8 {format}:- | xxd -p"
                ),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{options}");
        assert_eq!(result.stderr, "", "{options}");
        assert!(!result.used_typescript_bridge);
    }
}
