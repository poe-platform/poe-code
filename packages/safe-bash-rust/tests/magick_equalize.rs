use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

// Reference outputs: ImageMagick 7.1.2-35 Q16-HDRI.

#[test]
fn equalization_uses_the_cumulative_intensity_histogram() {
    for (options, expected) in [
        ("-equalize", "ff000000ff000000ff000000999999ffffff\n"),
        (
            "-auto-level -auto-gamma -equalize",
            "ff000000ff000000ff000000999999ffffff\n",
        ),
        (
            "-channel RGB -equalize",
            "ff000000ff000000ff000000555555ffffff\n",
        ),
        (
            "-channel R -equalize",
            "ff000000ff000000ff000000558080ffffff\n",
        ),
        (
            "-channel R +channel -equalize",
            "ff000000ff000000ff000000999999ffffff\n",
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
                &format!("set -o pipefail; magick sample.ppm {options} -depth 8 rgb:- | xxd -p"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout, expected, "{options}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn equalization_preserves_histogram_boundaries_and_channel_selection() {
    for (input, options, expected) in [
        (
            "P3 3 1 255 64 64 64 128 128 128 192 192 192",
            "",
            "555555aaaaaaffffff\n",
        ),
        ("P3 2 1 255 0 0 0 0 0 0", "", "000000000000\n"),
        ("P3 2 1 255 128 128 128 128 128 128", "", "ffffffffffff\n"),
        // The first intensity is just above 128 and must not enter its cumulative bin.
        ("P3 2 1 255 128 128 129 128 128 128", "", "8080ff808080\n"),
        ("P3 2 1 255 127 128 129 129 128 127", "", "0080ffff8000\n"),
        (
            "P3 3 1 255 64 64 64 128 128 128 192 192 192",
            "-channel R",
            "554040aa8080ffc0c0\n",
        ),
        (
            "P3 3 1 255 64 64 64 128 128 128 192 192 192",
            "-channel RGB",
            "555555aaaaaaffffff\n",
        ),
    ] {
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file("/sample.ppm", input.as_bytes()).unwrap();
        let mut shell = Shell::new(
            fs,
            ShellOptions {
                cwd: Some("/".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        let result = shell
            .exec_with_options(
                &format!(
                    "set -o pipefail; magick sample.ppm {options} -equalize -depth 8 rgb:- | xxd -p"
                ),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{input} {options}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{input} {options}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn equalization_applies_the_shared_histogram_to_active_alpha() {
    let mut shell = Shell::new(
        Arc::new(MemoryVfs::new()),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let result = shell
        .exec_with_options(
            "set -o pipefail; magick 'xc:#12345680' -equalize -depth 8 rgba:- | xxd -p",
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "00ffffff\n");
    assert_eq!(result.stderr, "");
    assert!(!result.used_typescript_bridge);
}
