use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn combine_distinct_grayscale_planes_into_one_rgb_frame() {
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
            r#"printf %s 'P2
2 1
255
255 0
' > red.pgm
printf %s 'P2
2 1
255
0 255
' > green.pgm
printf %s 'P2
2 1
255
0 0
' > blue.pgm
magick red.pgm green.pgm blue.pgm -combine -depth 8 rgb:out.rgb && xxd -p out.rgb"#,
            ExecOptions::default(),
        )
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "ff000000ff00\n");
    assert_eq!(result.stderr, "");
    assert!(!result.used_typescript_bridge);
}

#[test]
fn combine_consumes_the_stack_and_runs_pixel_operations_in_order() {
    for (inputs, expected) in [
        ("xc:red -separate -combine", "ff0000\n"),
        ("xc:red -separate -combine -negate", "00ffff\n"),
        ("xc:red xc:lime xc:blue -combine", "36b612\n"),
        ("xc:red -combine", "360000\n"),
        ("xc:white xc:black -combine", "ff00ff\n"),
        ("xc:white -negate xc:white xc:black -combine", "00ff00\n"),
        (
            "xc:white xc:black xc:black -combine xc:blue",
            "ff00000000ff\n",
        ),
    ] {
        let (mut shell, _) = Shell::with_memory_fs();
        let result = shell
            .exec_with_options(
                &format!("magick {inputs} -depth 8 rgb:out.rgb && xxd -p out.rgb"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{inputs}: {}", result.stderr);
        assert_eq!(result.stdout, expected, "{inputs}");
        assert_eq!(result.stderr, "", "{inputs}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn combine_uses_a_fourth_plane_as_alpha() {
    let (mut shell, _) = Shell::with_memory_fs();
    let result = shell
        .exec("magick xc:white xc:black xc:black 'xc:#808080' -combine -depth 8 rgba:out.rgba && xxd -p out.rgba")
        .unwrap();
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "ff000080\n");
}

#[test]
fn combine_rejects_an_oversized_stack_without_overwriting_output() {
    use safe_bash_rust::{SafeBashFs, ShellLimits};

    let (mut shell, fs) = Shell::with_memory_fs();
    shell.set_limits(ShellLimits {
        max_input_bytes: 4096,
        ..Default::default()
    });
    fs.write_file("/out.rgb", b"KEEP").unwrap();
    let result = shell
        .exec("magick -size 20x20 xc:white xc:black xc:black -combine rgb:/out.rgb")
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(
        result.stderr.contains("image exceeds memory budget"),
        "{}",
        result.stderr
    );
    assert_eq!(fs.read_file("/out.rgb").unwrap(), b"KEEP");
}
