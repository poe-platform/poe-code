use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn scale_averages_source_pixel_areas_independently_of_resize_filter() {
    for (options, format, expected) in [
        ("-scale 2x1!", "rgb", "6a40156a95bf\n"),
        ("-filter point -scale 2x1!", "rgb", "6a40156a95bf\n"),
        ("-scale 50%", "rgb", "6a40156a95bf\n"),
        ("-scale 1x1!", "rgb", "6a6a6a\n"),
        ("-scale 1x2!", "rgb", "555555808080\n"),
        ("-scale 3x1!", "rgb", "80000040c0408080ff\n"),
        (
            "-scale 3x2!",
            "rgb",
            "ff000000ff000000ff000000808080ffffff\n",
        ),
        (
            "-scale 4x2!",
            "rgb",
            "ff000055aa0000aa550000ff000000555555aaaaaaffffff\n",
        ),
        (
            "-scale 3x3!",
            "rgb",
            "ff000000ff000000ff80000040c0408080ff000000808080ffffff\n",
        ),
        ("-scale 6x4! -scale 2x1!", "rgb", "6a40156a95bf\n"),
        ("-transparent red -scale 2x1!", "rgba", "206020aa6a95bfff\n"),
        (
            "-transparent red -scale 6x4! -scale 2x1!",
            "rgba",
            "206020aa6a95bfff\n",
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

#[test]
fn scale_rejects_oversized_output_without_emitting_pixels() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec_with_options(
            "magick -size 1x1 xc:red -scale 100000x100000! -depth 8 rgb:-",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 1);
    assert_eq!(result.stdout, "");
    assert!(result.stderr.contains("image exceeds memory budget"));
}
