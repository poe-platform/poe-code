use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn shell() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.mkdir_all("/work").unwrap();
    let sh = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/work".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (sh, fs)
}

#[test]
fn terminal_registers_and_null_do_not_publish_files() {
    for destination in ["mpr:final", "MPR:Final[0]", "null:"] {
        let (mut sh, fs) = shell();
        let command = format!("magick -size 1x1 xc:blue {destination}");
        let result = sh.exec(&command).unwrap();
        assert_eq!(result.exit_code, 0, "{command}: {}", result.stderr);
        assert!(result.stdout.is_empty());
        assert!(result.stderr.is_empty());
        assert!(fs.read_dir("/work").unwrap().is_empty(), "{command}");
        fs.write_file(&format!("/work/{destination}"), b"KEEP")
            .unwrap();
        assert_eq!(sh.exec(&command).unwrap().exit_code, 0);
        assert_eq!(
            fs.read_file(&format!("/work/{destination}")).unwrap(),
            b"KEEP"
        );
        fs.write_file("/work/input.ppm", b"P6\n1 1\n255\n\0\0\xff")
            .unwrap();
        assert_eq!(
            sh.exec(&format!("magick input.ppm {destination}"))
                .unwrap()
                .exit_code,
            0
        );
        assert_eq!(
            fs.read_file(&format!("/work/{destination}")).unwrap(),
            b"KEEP"
        );
        assert_eq!(fs.read_dir("/work").unwrap().len(), 2);
    }
}

#[test]
fn terminal_registers_publish_prior_explicit_writes() {
    for destination in ["mpr:final", "MPR:Final[0]", "null:"] {
        let (mut sh, fs) = shell();
        let result = sh
            .exec(&format!(
                "magick -size 1x1 xc:blue -depth 8 -write saved.ppm {destination}"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(result.stdout.is_empty());
        assert!(result.stderr.is_empty());
        assert_eq!(fs.read_dir("/work").unwrap(), ["saved.ppm"]);
        assert_eq!(
            fs.read_file("/work/saved.ppm").unwrap(),
            b"P6\n1 1\n255\n\0\0\xff"
        );
    }
}

#[test]
fn terminal_registers_still_require_valid_images() {
    for command in [
        "magick missing.png mpr:final",
        "magick mpr:final",
        "magick mpr:final later.png",
        "magick xc:blue missing.png mpr:final",
    ] {
        let (mut sh, fs) = shell();
        assert_ne!(sh.exec(command).unwrap().exit_code, 0, "{command}");
        assert!(fs.read_dir("/work").unwrap().is_empty(), "{command}");
    }
}

#[test]
fn terminal_output_failure_keeps_prior_explicit_writes() {
    let (mut sh, fs) = shell();
    fs.write_file("/work/broken.bin", b"not an image").unwrap();
    let result = sh
        .exec("magick xc:blue -depth 8 -write saved.ppm broken.bin mpr:final")
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert_eq!(
        fs.read_file("/work/saved.ppm").unwrap(),
        b"P6\n1 1\n255\n\0\0\xff"
    );
    assert!(!fs.exists("/work/mpr:final"));
}
