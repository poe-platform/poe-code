use safe_bash_rust::{BackendMode, ExecOptions, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::collections::BTreeMap;
use std::sync::Arc;

fn fixture() -> (Shell, MemoryVfs) {
    let fs = MemoryVfs::new();
    fs.write_file(
        "/data.txt",
        b"UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAADoA9AHuAugDxj8MPhI9GDwiBNwF1gbQB8AAAAAAAAAAA==",
    )
    .unwrap();
    let shell = Shell::new(
        Arc::new(fs.clone()),
        ShellOptions {
            cwd: Some("/".into()),
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    (shell, fs)
}

#[test]
fn unsupported_pcm_filters_fail_without_publishing_audio() {
    for filter in [
        "atrim=start_sample=3:end_sample=7",
        "pan=stereo|c0=c0|c1=c0",
        "volume=0.5,atrim=start_sample=3:end_sample=7",
        "no_such_audio_filter",
    ] {
        for output in ["- | xxd -p", "new.pcm", "existing.pcm"] {
            let (mut shell, fs) = fixture();
            fs.write_file("/existing.pcm", b"preserve destination")
                .unwrap();
            let result = shell
                .exec_with_options(
                    &format!(
                        "set -o pipefail; base64 -d data.txt > input.wav; ffmpeg -nostdin -v error -y -i input.wav -af '{filter}' -f s16le {output}"
                    ),
                    ExecOptions {
                        cwd: Some("/".into()),
                        env: BTreeMap::from([
                            ("LC_ALL".into(), "C".into()),
                            ("TZ".into(), "UTC".into()),
                        ]),
                        ..Default::default()
                    },
                )
                .unwrap();
            assert_ne!(result.exit_code, 0, "{filter}, {output}: {result:?}");
            assert!(result.stdout.is_empty(), "{filter}, {output}: {result:?}");
            let unsupported = filter.split(',').next_back().unwrap();
            assert!(
                result
                    .stderr
                    .contains(&format!("Unsupported audio filter '{unsupported}'")),
                "{filter}, {output}: {result:?}"
            );
            assert!(!result.used_typescript_bridge);
            assert!(!fs.exists("/new.pcm"));
            assert_eq!(
                fs.read_file("/existing.pcm").unwrap(),
                b"preserve destination"
            );
        }
    }
}

#[test]
fn supported_pcm_filters_still_transform_samples() {
    for (filter, expected) in [
        (
            "anull",
            "e803d007b80ba00f18fc30f848f460f088137017581b401f000000000000\n0000\n",
        ),
        (
            "volume=0.5",
            "f401e803dc05d0070cfe18fc24fa30f8c409b80bac0da00f000000000000\n0000\n",
        ),
        (
            "areverse",
            "0000000000000000401f581b7017881360f048f430f818fca00fb80bd007\ne803\n",
        ),
    ] {
        let (mut shell, _) = fixture();
        let result = shell.exec(&format!(
            "set -o pipefail; base64 -d data.txt > input.wav; ffmpeg -nostdin -v error -i input.wav -af '{filter}' -f s16le - | xxd -p"
        )).unwrap();
        assert_eq!(result.exit_code, 0, "{filter}: {result:?}");
        assert_eq!(result.stdout, expected, "{filter}");
        assert_eq!(result.stderr, "", "{filter}");
        assert!(!result.used_typescript_bridge);
    }
}
