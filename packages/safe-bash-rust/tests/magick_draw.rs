use safe_bash_rust::{
    BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions,
};
use std::sync::Arc;

fn shell() -> (Shell, Arc<MemoryVfs>) {
    let fs = Arc::new(MemoryVfs::new());
    fs.write_file(
        "/sample.ppm",
        b"P3\n3 2\n255\n255 0 0   0 255 0   0 0 255\n0 0 0   128 128 128   255 255 255\n",
    )
    .unwrap();
    let shell = Shell::new(
        fs.clone(),
        ShellOptions {
            cwd: Some("/".into()),
            env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
            mode: BackendMode::NativeOnly,
        },
    );
    (shell, fs)
}

#[test]
fn draw_paints_pixels_through_the_native_shell() {
    // ImageMagick 7.1.2 Q16-HDRI reference output.
    for (options, expected) in [
        (
            "-fill yellow -draw 'point 1,0'",
            "ff0000ffff000000ff000000808080ffffff\n",
        ),
        (
            "-fill yellow -draw 'rectangle 0,0 1,1'",
            "ffff00ffff000000ffffff00ffff00ffffff\n",
        ),
        (
            "-fill yellow -draw 'rectangle 1,1 0,0'",
            "ffff00ffff000000ffffff00ffff00ffffff\n",
        ),
        (
            "-fill yellow -draw 'point 1,0 point 2,1'",
            "ff0000ffff000000ff000000808080ffff00\n",
        ),
        (
            "-fill yellow -draw 'point 1,0' -fill blue -draw 'point 1,1'",
            "ff0000ffff000000ff0000000000ffffffff\n",
        ),
        (
            "-fill yellow -draw 'point 0.5,0'",
            "ffff0000ff000000ff000000808080ffffff\n",
        ),
        (
            "-fill yellow -draw 'point 0.6,0'",
            "ff0000ffff000000ff000000808080ffffff\n",
        ),
        (
            "-fill yellow -draw 'point -0.6,0 point 1e30,1'",
            "ff000000ff000000ff000000808080ffffff\n",
        ),
        (
            "-fill yellow -draw 'rectangle -1000000000,-1000000000 0,0'",
            "ffff0000ff000000ff000000808080ffffff\n",
        ),
        (
            "-fill yellow -draw 'rectangle 0.5,0.5 1.5,1.5'",
            "ff160040ff001616e9404000ffff00ffffbf\n",
        ),
        (
            "-fill none -draw 'rectangle 0,0 2,1'",
            "ff000000ff000000ff000000808080ffffff\n",
        ),
        (
            "-fill 'rgba(255,255,0,0.5)' -draw 'point 0,0'",
            "ff800000ff000000ff000000808080ffffff\n",
        ),
        (
            "-colorspace gray -fill yellow -draw 'point 1,0'",
            "363636ffff00121212000000808080ffffff\n",
        ),
        (
            "-fill yellow -draw 'point 1,0' -flop",
            "0000ffffff00ff0000ffffff808080000000\n",
        ),
    ] {
        let (mut shell, _) = shell();
        let result = shell
            .exec_with_options(
                &format!("set -o pipefail; magick sample.ppm {options} -depth 8 rgb:- | xxd -p"),
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
fn invalid_draw_fails_without_publishing_an_image() {
    for draw in [
        "point 1",
        "rectangle 0,0",
        "nonsense 1,0",
        "point 1,0 garbage",
    ] {
        for destination in ["rgb:-", "result.ppm"] {
            let (mut shell, fs) = shell();
            fs.write_file("/result.ppm", b"original").unwrap();
            let result = shell
                .exec_with_options(
                    &format!("magick sample.ppm -fill yellow -draw '{draw}' {destination}"),
                    ExecOptions::default(),
                )
                .unwrap();
            assert_ne!(result.exit_code, 0, "{draw}");
            assert_eq!(result.stdout, "", "{draw}");
            assert!(!result.stderr.is_empty(), "{draw}");
            assert_eq!(fs.read_file("/result.ppm").unwrap(), b"original");
            assert!(!result.used_typescript_bridge);
        }
    }
}

#[test]
fn draw_uses_the_current_image_stack_and_command_aliases() {
    for command in [
        "convert sample.ppm -fill yellow -draw 'point 1,0' -depth 8 rgb:-",
        "magick sample.ppm -fill yellow -draw 'point 1,0' -write result.ppm null:; magick result.ppm -depth 8 rgb:-",
        "mogrify -fill yellow -draw 'point 1,0' sample.ppm; magick sample.ppm -depth 8 rgb:-",
    ] {
        let (mut shell, _) = shell();
        let result = shell
            .exec_with_options(
                &format!("set -o pipefail; {{ {command}; }} | xxd -p"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert_eq!(
            result.stdout, "ff0000ffff000000ff000000808080ffffff\n",
            "{command}"
        );
        assert_eq!(result.stderr, "", "{command}");
        assert!(!result.used_typescript_bridge);
    }
}

#[test]
fn drawing_limits_preserve_the_destination() {
    for drawing in ["rectangle 0,0 15,15 ".repeat(20), "point 0,0 ".repeat(200)] {
        let (mut shell, fs) = shell();
        shell.set_limits(ShellLimits {
            max_input_bytes: 4096,
            ..Default::default()
        });
        fs.write_file("/result.ppm", b"original").unwrap();
        let result = shell
            .exec_with_options(
                &format!("magick -size 16x16 xc:red -draw '{drawing}' result.ppm"),
                ExecOptions::default(),
            )
            .unwrap();
        assert_ne!(result.exit_code, 0);
        assert!(
            result.stderr.contains("drawing exceeds resource limits"),
            "{}",
            result.stderr
        );
        assert_eq!(result.stdout, "");
        assert_eq!(fs.read_file("/result.ppm").unwrap(), b"original");
    }
}
