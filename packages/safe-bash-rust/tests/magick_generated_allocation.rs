use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellLimits, ShellOptions};
use std::sync::Arc;

#[test]
fn generated_images_reject_oversized_allocations_and_preserve_outputs() {
    for (size, input) in [
        ("100000x100000", "xc:blue"),
        ("30000x20000", "canvas:blue"),
        ("1x500000000", "xc:blue"),
        ("8000x8000", "xc:rgba(0,0,255,0.5)"),
    ] {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/work").unwrap();
        fs.write_file("/work/out.ppm", b"KEEP").unwrap();
        let mut sh = Shell::new(
            Arc::new(fs.clone()),
            ShellOptions {
                cwd: Some("/work".into()),
                mode: BackendMode::NativeOnly,
                ..Default::default()
            },
        );
        sh.set_limits(ShellLimits {
            max_input_bytes: 1024 * 1024,
            max_memory_bytes: 8 * 1024 * 1024,
            ..Default::default()
        });
        assert_eq!(
            sh.exec("magick -size 1x1 xc:blue null:").unwrap().exit_code,
            0
        );
        let result = sh
            .exec(&format!(
                "magick -size 1x1 xc:blue -depth 8 -write saved.ppm -size {size} '{input}' out.ppm"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 1, "{size} {input}");
        assert!(
            result.stderr.contains("image exceeds memory budget"),
            "{}",
            result.stderr
        );
        assert_eq!(fs.read_file("/work/out.ppm").unwrap(), b"KEEP");
        assert_eq!(
            fs.read_file("/work/saved.ppm").unwrap(),
            b"P6\n1 1\n255\n\0\0\xff"
        );
        assert_eq!(fs.read_dir("/work").unwrap().len(), 2);
    }
}
