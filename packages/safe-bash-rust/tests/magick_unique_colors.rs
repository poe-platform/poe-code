use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn unique_colors_exports_one_pixel_per_distinct_input_color_through_shell() {
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
            "printf %s 'P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n255 255 255  0 0 0  255 255 0\n' > colors.ppm\nmagick colors.ppm colors.ppm +append -unique-colors -depth 8 rgb:out.rgb && xxd -p out.rgb",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    // ImageMagick 7.1.2-32: black, red, green, yellow, blue, white.
    assert_eq!(result.stdout, "000000ff000000ff00ffff000000ffffffff\n");
    assert_eq!(result.stderr, "");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn unique_colors_preserves_distinct_samples_and_operation_order() {
    for (input, operations, expected) in [
        // The low bit does not split a color-tree leaf; retain first occurrence.
        (
            "xc:#010101 xc:black xc:#010101 +append",
            "-unique-colors",
            "010101ff000000ff\n",
        ),
        (
            "xc:#ff0000ff xc:#ff000000 xc:#ff000080 xc:#ff000000 +append",
            "-unique-colors -unique-colors",
            "ff000000ff000080ff0000ff\n",
        ),
        (
            "xc:#ff0000ff xc:#ff000000 +append",
            "-alpha off -unique-colors",
            "ff0000ff\n",
        ),
        (
            "-size 3x2 xc:#808080",
            "-colorspace Gray -unique-colors",
            "808080ff\n",
        ),
        (
            "xc:red xc:blue xc:red +append",
            "-unique-colors -negate",
            "00ffffffffff00ff\n",
        ),
        (
            "xc:red xc:blue xc:red +append",
            "-negate -unique-colors",
            "ffff00ff00ffffff\n",
        ),
        (
            "-size 2x2 xc:red xc:blue",
            "-unique-colors",
            "ff0000ff0000ffff\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec(&format!(
                "magick {input} {operations} -depth 8 rgba:/out && xxd -p /out"
            ))
            .unwrap();
        assert_eq!(
            result.exit_code, 0,
            "{input} {operations}: {}",
            result.stderr
        );
        assert_eq!(result.stdout, expected, "{input} {operations}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn unique_colors_updates_dimensions_for_conversion_and_in_place_edits() {
    for command in ["magick", "convert", "magick convert", "mogrify"] {
        let (mut shell, _) = Shell::with_memory_fs();
        let setup = shell.exec("magick -size 3x2 xc:red /input.ppm").unwrap();
        assert_eq!(setup.exit_code, 0, "{}", setup.stderr);
        let operation = if command == "mogrify" {
            "mogrify -unique-colors /input.ppm".to_owned()
        } else {
            format!("{command} /input.ppm -unique-colors /input.ppm")
        };
        let result = shell
            .exec(&format!("{operation} && identify /input.ppm"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert!(
            result.stdout.contains("1x1"),
            "{command}: {}",
            result.stdout
        );
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
