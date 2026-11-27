use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn contrast_stretch_clips_intensity_histogram_at_requested_counts() {
    for (options, middle) in [
        ("-contrast-stretch 1x1", "aaaaaa"),
        ("-contrast-stretch 1", "aaaaaa"),
        ("-contrast-stretch 0x1", "b3b3b3"),
        ("-contrast-stretch 1x0", "767676"),
        ("-contrast-stretch 20%x10%", "767676"),
        ("-contrast-stretch 0", "808080"),
        ("-channel RGB -contrast-stretch 1x1", "808080"),
        ("-channel RGB +channel -contrast-stretch 1x1", "aaaaaa"),
        ("-normalize", "808080"),
        ("-linear-stretch 1x1", "808080"),
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
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(
            result.stdout,
            format!("ff000000ff000000ff000000{middle}ffffff\n"),
            "{options}"
        );
        assert_eq!(result.stderr, "", "{options}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn contrast_stretch_respects_channel_selection_and_stretches_alpha_by_default() {
    for (options, expected) in [
        (
            "-contrast-stretch 1x1",
            "000024ff0024ffff24ffff00ffffffff\n",
        ),
        (
            "-channel RGB -contrast-stretch 1x1",
            "00000080000000c0ffffff40ffffffff\n",
        ),
        (
            "-channel red -contrast-stretch 1x1",
            "00406080006080c0ff80a040ffa0c0ff\n",
        ),
        (
            "-channel alpha -contrast-stretch 1x1",
            "20406000406080ff6080a00080a0c0ff\n",
        ),
        ("-normalize", "000c61b60c61b6ff61b6ff0cb6ffffff\n"),
        (
            "-contrast-stretch 0x0",
            "000c61b60c61b6ff61b6ff0cb6ffffff\n",
        ),
    ] {
        let fs = Arc::new(MemoryVfs::new());
        fs.write_file(
            "/sample.png",
            &terminal_png_rust::png::encode(
                4,
                1,
                &[
                    32, 64, 96, 128, 64, 96, 128, 192, 96, 128, 160, 64, 128, 160, 192, 255,
                ],
            )
            .unwrap(),
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
                &format!("set -o pipefail; magick sample.png {options} -depth 8 rgba:- | xxd -p"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{options}");
        assert_eq!(result.stderr, "", "{options}");
        assert!(!result.used_typescript_bridge);
    }
}
