use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn adts_alias_uses_the_aac_encoder_and_demuxer() {
    let fs = MemoryVfs::new();
    let mut shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    for format in ["aac", "adts"] {
        let result = shell
            .exec(&format!(
                "ffmpeg -f lavfi -i sine=frequency=440:duration=0.01 -f {format} /{format}.bin"
            ))
            .unwrap();
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert!(!result.used_typescript_bridge);
    }
    let encoded = fs.read_file("/aac.bin").unwrap();
    assert!(!encoded.is_empty());
    assert_eq!(fs.read_file("/adts.bin").unwrap(), encoded);
    let original = shell
        .exec("ffprobe -f aac -show_format -show_streams /aac.bin")
        .unwrap();
    let alias = shell
        .exec("ffprobe -f adts -show_format -show_streams /aac.bin")
        .unwrap();
    assert_eq!(original.exit_code, 0, "{}", original.stderr);
    assert_eq!(alias.exit_code, 0, "{}", alias.stderr);
    assert_eq!(alias.stdout, original.stdout);
    assert!(!alias.used_typescript_bridge);
}
