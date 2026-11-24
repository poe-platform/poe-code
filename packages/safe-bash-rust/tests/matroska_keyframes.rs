use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

fn element(id: &[u8], data: &[u8]) -> Vec<u8> {
    let mut bytes = id.to_vec();
    assert!(data.len() < 16383);
    bytes.extend_from_slice(&(0x4000 | data.len() as u16).to_be_bytes());
    bytes.extend_from_slice(data);
    bytes
}

#[test]
fn matroska_block_groups_use_references_to_identify_keyframes() {
    let track = element(
        &[0xae],
        &[
            element(&[0xd7], &[1]),
            element(&[0x83], &[1]),
            element(&[0x86], b"V_VP8"),
        ]
        .concat(),
    );
    let mut blocks = Vec::new();
    // ReferenceBlock presence matters even when its value is zero, and its
    // position in the group does not matter. Block flags have no keyframe bit.
    for (time, reference, reference_first) in [
        (0u16, None, false),
        (100, Some(0u8), false),
        (200, Some(156), true),
    ] {
        let block = element(
            &[0xa1],
            &[0x81, (time >> 8) as u8, time as u8, 0x80, 0, 1, 2],
        );
        let reference = reference
            .map(|n| element(&[0xfb], &[n]))
            .unwrap_or_default();
        blocks.extend(element(
            &[0xa0],
            &if reference_first {
                [reference, block].concat()
            } else {
                [block, reference].concat()
            },
        ));
    }
    // SimpleBlock continues to use its own keyframe flag.
    blocks.extend(element(&[0xa3], &[0x81, 1, 44, 0x80, 0, 1, 2]));
    blocks.extend(element(&[0xa3], &[0x81, 1, 144, 0, 1, 2, 3]));
    let source = [
        element(&[0x1a, 0x45, 0xdf, 0xa3], &element(&[0x42, 0x82], b"webm")),
        element(
            &[0x18, 0x53, 0x80, 0x67],
            &[
                element(&[0x16, 0x54, 0xae, 0x6b], &track),
                element(&[0x1f, 0x43, 0xb6, 0x75], &blocks),
            ]
            .concat(),
        ),
    ]
    .concat();
    let fs = MemoryVfs::new();
    fs.write_file("/input.webm", &source).unwrap();
    let mut shell = Shell::new(
        Arc::new(fs),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let probe = shell
        .exec("ffprobe -v error -show_packets -show_entries packet=flags -of csv=p=0 /input.webm")
        .unwrap();
    assert_eq!(probe.exit_code, 0, "{}", probe.stderr);
    assert!(!probe.used_typescript_bridge);
    assert_eq!(
        probe.stdout.lines().collect::<Vec<_>>(),
        ["K__", "___", "___", "K__", "___"]
    );
    let cut = shell
        .exec("ffmpeg -ss 0.15 -i /input.webm -t 0.2 -c copy /clip.webm")
        .unwrap();
    assert_eq!(cut.exit_code, 0, "{}", cut.stderr);
    let probe = shell
        .exec("ffprobe -v error -show_packets -show_entries packet=flags -of csv=p=0 /clip.webm")
        .unwrap();
    assert_eq!(probe.exit_code, 0, "{}", probe.stderr);
    assert_eq!(
        probe.stdout.lines().collect::<Vec<_>>(),
        ["K__", "___", "___", "K__"]
    );
}

#[test]
fn matroska_stream_copy_keeps_audio_aligned_with_video_preroll() {
    let mut tracks = Vec::new();
    for (id, kind, codec) in [(1, 1, b"V_VP8".as_slice()), (2, 2, b"A_OPUS".as_slice())] {
        tracks.extend(element(
            &[0xae],
            &[
                element(&[0xd7], &[id]),
                element(&[0x83], &[kind]),
                element(&[0x86], codec),
            ]
            .concat(),
        ));
    }
    let mut blocks = Vec::new();
    for time in [0u16, 100, 200, 300, 400] {
        for id in [1, 2] {
            let flags = if id == 2 || time == 0 { 0x80 } else { 0 };
            blocks.extend(element(
                &[0xa3],
                &[0x80 | id, (time >> 8) as u8, time as u8, flags, 0, 1, 2],
            ));
        }
    }
    let source = [
        element(&[0x1a, 0x45, 0xdf, 0xa3], &element(&[0x42, 0x82], b"webm")),
        element(
            &[0x18, 0x53, 0x80, 0x67],
            &[
                element(&[0x16, 0x54, 0xae, 0x6b], &tracks),
                element(&[0x1f, 0x43, 0xb6, 0x75], &blocks),
            ]
            .concat(),
        ),
    ]
    .concat();
    let fs = MemoryVfs::new();
    fs.write_file("/input.webm", &source).unwrap();
    let mut shell = Shell::new(
        Arc::new(fs),
        ShellOptions {
            mode: BackendMode::NativeOnly,
            ..Default::default()
        },
    );
    let cut = shell
        .exec("ffmpeg -ss 0.15 -i /input.webm -t 0.2 -c copy /clip.webm")
        .unwrap();
    assert_eq!(cut.exit_code, 0, "{}", cut.stderr);
    let probe = shell.exec("ffprobe -v error -select_streams a -show_packets -show_entries packet=pts_time -of csv=p=0 /clip.webm").unwrap();
    assert_eq!(probe.exit_code, 0, "{}", probe.stderr);
    // The preceding video keyframe is at 0; retained audio starts at 0.1.
    // Starting each stream independently at zero would move the audio early.
    assert_eq!(probe.stdout.lines().next(), Some("0.100000"));
}
