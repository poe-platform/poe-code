use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn modulation_uses_hsl_and_preserves_alpha() {
    for (options, format, expected) in [
        (
            "-modulate 100,0,100",
            "rgb",
            "808080808080808080000000808080ffffff\n",
        ),
        (
            "-modulate 100,100,100",
            "rgb",
            "ff000000ff000000ff000000808080ffffff\n",
        ),
        (
            "-modulate 50,0,100",
            "rgb",
            "404040404040404040000000404040808080\n",
        ),
        (
            "-modulate 50,-30",
            "rgb",
            "2d5353532d5353532d000000404040808080\n",
        ),
        (
            "-modulate 100,100,200",
            "rgb",
            "00ffffff00ffffff00000000808080ffffff\n",
        ),
        (
            "-transparent red -modulate 100,0,100",
            "rgba",
            "80808000808080ff808080ff000000ff808080ffffffffff\n",
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
fn modulation_matches_hsl_reference_for_translucent_colors() {
    // ImageMagick 7.1.2 Q16-HDRI reference samples, also covered by the TS command.
    for (color, value, expected) in [
        ("#1964dc80", "80,60,120", "47339180\n"),
        ("#80402080", "80,60,120", "57542980\n"),
        ("#ff000080", "80,60,120", "a3722980\n"),
        ("#1964dc80", "150,140,40", "86ff6880\n"),
        ("#1964dc80", "100,0,100", "7b7b7b80\n"),
        ("#1964dc80", "100,100,100", "1964dc80\n"),
        ("#1964dc80", "100,100,300", "1964dc80\n"),
        ("#1964dc80", "100,100,-100", "1964dc80\n"),
    ] {
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
                &format!(
                    "set -o pipefail; magick 'xc:{color}' -modulate {value} -depth 8 rgba:- | xxd -p"
                ),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{color} {value}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{color} {value}");
        assert_eq!(result.stderr, "");
        assert!(!result.used_typescript_bridge);
    }
}
