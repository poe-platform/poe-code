use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn magick_sample_selects_source_pixels_through_shell() {
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
    for (geometry, expected) in [
        ("2x1!", "ff00000000ff\n"),
        ("1x1!", "00ff00\n"),
        ("3x1!", "ff000000ff000000ff\n"),
        ("2x2!", "ff00000000ff000000ffffff\n"),
    ] {
        let result = shell
            .exec_with_options(
                &format!(
                    "set -o pipefail; magick sample.ppm -sample {geometry} -depth 8 rgb:- | xxd -p"
                ),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(result.stdout, expected, "sample {geometry}");
        assert!(result.stderr.is_empty(), "{result:?}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn magick_sample_maps_both_axes_when_shrinking_and_enlarging() {
    for (source, target, expected) in [
        (2, 1, vec![0]),
        (3, 2, vec![0, 2]),
        (4, 2, vec![0, 2]),
        (5, 2, vec![1, 3]),
        (6, 2, vec![1, 4]),
        (7, 3, vec![1, 3, 5]),
        (3, 5, vec![0, 0, 1, 2, 2]),
        (2, 4, vec![0, 0, 1, 1]),
    ] {
        for vertical in [false, true] {
            let fs = Arc::new(MemoryVfs::new());
            let (width, height) = if vertical { (1, source) } else { (source, 1) };
            let pixels = (0..source).map(|i| format!("{i} 0 0 ")).collect::<String>();
            fs.write_file(
                "/input.ppm",
                format!("P3\n{width} {height}\n255\n{pixels}").as_bytes(),
            )
            .unwrap();
            let mut shell = Shell::new(fs.clone(), ShellOptions::default());
            let geometry = if vertical {
                format!("1x{target}!")
            } else {
                format!("{target}x1!")
            };
            let result = shell
                .exec(&format!(
                    "magick /input.ppm -sample {geometry} -depth 8 rgb:/output.rgb"
                ))
                .unwrap();
            assert_eq!(result.exit_code, 0, "{result:?}");
            let expected: Vec<u8> = expected.iter().flat_map(|&i| [i, 0, 0]).collect();
            assert_eq!(
                fs.read_file("/output.rgb").unwrap(),
                expected,
                "{width}x{height} -> {geometry}"
            );
        }
    }
}
