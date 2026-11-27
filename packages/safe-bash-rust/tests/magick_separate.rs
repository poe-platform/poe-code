use safe_bash_rust::{SafeBashFs, Shell};

#[test]
fn separate_emits_each_selected_channel_in_image_order() {
    let (mut shell, fs) = Shell::with_memory_fs();
    fs.write_file(
        "/sample.ppm",
        b"P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n0 0 0 128 128 128 255 255 255\n",
    )
    .unwrap();
    let result = shell
        .exec("set -o pipefail; magick /sample.ppm -separate -depth 8 rgb:- | xxd -p")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        result.stdout,
        "ffffff000000000000000000808080ffffff000000ffffff000000000000\n808080ffffff000000000000ffffff000000808080ffffff\n"
    );
    for (options, expected) in [
        ("-channel B -separate", vec![0, 0, 255, 0, 128, 255]),
        (
            "-channel R -separate +channel -negate",
            vec![0, 255, 255, 255, 127, 0],
        ),
        (
            "-negate -channel R -separate",
            vec![0, 255, 255, 255, 127, 0],
        ),
        (
            "-channel B +channel -separate -delete 0,1",
            vec![0, 0, 255, 0, 128, 255],
        ),
    ] {
        let result = shell
            .exec(&format!(
                "magick /sample.ppm {options} -depth 8 rgb:/out.rgb"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{options}: {}", result.stderr);
        let bytes: Vec<u8> = expected.into_iter().flat_map(|v| [v; 3]).collect();
        assert_eq!(fs.read_file("/out.rgb").unwrap(), bytes, "{options}");
    }
}

#[test]
fn separate_preserves_stack_order_alpha_samples_and_split_files() {
    let (mut shell, fs) = Shell::with_memory_fs();
    let result = shell
        .exec("magick xc:red xc:blue -separate -depth 8 rgb:/frames.rgb")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        fs.read_file("/frames.rgb").unwrap(),
        [
            255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255
        ]
    );
    let result = shell
        .exec(
            "magick 'xc:rgba(100,50,25,0.5)' -channel RGBA -separate -depth 8 rgb:/channel-%d.rgb",
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    for (index, value) in [100, 50, 25, 128].into_iter().enumerate() {
        assert_eq!(
            fs.read_file(&format!("/channel-{index}.rgb")).unwrap(),
            [value; 3]
        );
    }
    let result = shell
        .exec("magick xc:red -alpha off -channel RGBA -separate -depth 8 rgb:/opaque.rgb")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(
        fs.read_file("/opaque.rgb").unwrap(),
        [255, 255, 255, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn separate_rejects_frame_expansion_over_budget_without_publishing() {
    let (mut shell, fs) = Shell::with_memory_fs();
    shell.set_limits(safe_bash_rust::ShellLimits {
        max_input_bytes: 4096,
        ..Default::default()
    });
    fs.write_file("/out.rgb", b"KEEP").unwrap();
    let result = shell
        .exec("magick -size 20x20 xc:red -separate rgb:/out.rgb")
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(result.stdout.is_empty());
    assert!(
        result.stderr.contains("image exceeds memory budget"),
        "{}",
        result.stderr
    );
    assert_eq!(fs.read_file("/out.rgb").unwrap(), b"KEEP");
}

#[test]
fn separate_emits_one_grayscale_frame_and_black_for_absent_channels() {
    let (mut shell, fs) = Shell::with_memory_fs();
    for (source, options, expected) in [
        ("xc:red", "-colorspace gray -separate", 54),
        ("xc:red", "-alpha off -channel A -separate", 0),
        ("xc:red", "-colorspace gray -channel B -separate", 0),
    ] {
        let result = shell
            .exec(&format!("magick {source} {options} -depth 8 rgb:/out.rgb"))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(fs.read_file("/out.rgb").unwrap(), [expected; 3]);
    }
}
