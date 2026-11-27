use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

#[test]
fn pcm_exports_reject_unsupported_filters_without_publishing_audio() {
    for filter in [
        "atrim=start_sample=3:end_sample=7",
        "pan=mono|c0=c0",
        "volume=0.5,atrim=start_sample=3:end_sample=7",
        "not_an_audio_filter",
    ] {
        for output in ["- | xxd -p", "output.raw"] {
            let fs = Arc::new(MemoryVfs::new());
            fs.write_file("/data.txt", b"UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAADoA9AHuAugDxj8MPhI9GDwiBNwF1gbQB8AAAAAAAAAAA==").unwrap();
            fs.write_file("/output.raw", b"preserve destination")
                .unwrap();
            let mut shell = Shell::new(
                fs.clone(),
                ShellOptions {
                    cwd: Some("/".into()),
                    env: [("LC_ALL".into(), "C".into()), ("TZ".into(), "UTC".into())].into(),
                    mode: BackendMode::NativeOnly,
                },
            );
            let result = shell.exec_with_options(
                &format!("set -o pipefail; base64 -d data.txt > input.wav; ffmpeg -nostdin -v error -y -i input.wav -af '{filter}' -f s16le {output}"),
                ExecOptions::default(),
            ).unwrap();
            assert_ne!(result.exit_code, 0, "{filter}: {output}");
            assert!(
                result.stderr.contains("Unsupported audio filter"),
                "{}",
                result.stderr
            );
            assert_eq!(result.stdout, "", "{filter}: {output}");
            assert_eq!(
                fs.read_file("/output.raw").unwrap(),
                b"preserve destination"
            );
            assert!(!result.used_typescript_bridge);
        }
    }
}
