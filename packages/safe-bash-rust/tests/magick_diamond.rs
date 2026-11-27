use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn morphology_respects_the_kernel_footprint_through_shell() {
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
    // ImageMagick reference outputs, including rectangular and compound operations.
    for (method, kernel, expected) in [
        ("Erode", "Diamond:1", "000000000000000000000000000000000080"),
        (
            "Dilate",
            "Diamond:1",
            "ffff00ffffffffffffff8080ffffffffffff",
        ),
        ("Open", "Diamond:1", "000000000000000080000000000080000080"),
        ("Close", "Diamond:1", "ff8000ffff00ffffffff8000ff8080ffffff"),
        ("Erode", "Diamond:2", "000000000000000000000000000000000000"),
        (
            "Dilate",
            "Diamond:100",
            "ffffffffffffffffffffffffffffffffffff",
        ),
        ("Erode", "Square:1", "000000000000000000000000000000000000"),
        ("Dilate", "Square:1", "ffff80ffffffffffffffff80ffffffffffff"),
    ] {
        let result = shell.exec_with_options(
            &format!("set -o pipefail; magick sample.ppm -morphology {method} {kernel} -depth 8 rgb:- | xxd -p"),
            ExecOptions::default(),
        ).unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(result.stdout, format!("{expected}\n"), "{method} {kernel}");
        assert!(result.stderr.is_empty(), "{result:?}");
        assert!(!result.used_typescript_bridge);
    }
    for operation in ["-statistic Median 3x3", "-median 3"] {
        let result = shell
            .exec(&format!(
                "set -o pipefail; magick sample.ppm {operation} -depth 8 rgb:- | xxd -p"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{result:?}");
        assert_eq!(
            result.stdout, "8000000000000080ff00000080808080ffff\n",
            "{operation}"
        );
    }
}

#[test]
fn radius_two_diamond_excludes_distant_diagonals() {
    let fs = Arc::new(MemoryVfs::new());
    let mut input = b"P5\n5 5\n255\n".to_vec();
    input.extend([0].into_iter().chain([255; 24]));
    fs.write_file("/input.pgm", &input).unwrap();
    let mut shell = Shell::new(fs.clone(), ShellOptions::default());
    let result = shell
        .exec("magick /input.pgm -morphology Erode Diamond:2 -depth 8 rgb:/output.rgb")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{result:?}");
    assert!(result.stderr.is_empty(), "{result:?}");
    assert_eq!(
        fs.read_file("/output.rgb").unwrap(),
        [
            0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
            255, 255, 255, 255, 255,
        ]
        .into_iter()
        .flat_map(|value| [value; 3])
        .collect::<Vec<_>>()
    );
}
