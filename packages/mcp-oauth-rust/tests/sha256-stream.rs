use mcp_oauth_rust::{Sha256, sha256};
use std::process::Command;
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}
#[test]
fn incremental_hashes_match_builtin_crypto_across_padding_and_chunk_boundaries() {
    let lengths = [
        0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024, 8192,
    ];
    let result=Command::new("node").args(["--input-type=module","-e","import{createHash}from'node:crypto';for(const n of[0,1,55,56,57,63,64,65,119,120,127,128,129,1024,8192]){const bytes=Buffer.from(Array.from({length:n},(_,i)=>(i*17+31)&255));console.log(createHash('sha256').update(bytes).digest('hex'));}"]).output().unwrap();
    assert!(result.status.success());
    let expected = String::from_utf8(result.stdout).unwrap();
    for (length, digest) in lengths.into_iter().zip(expected.lines()) {
        let bytes = (0..length)
            .map(|index| ((index * 17 + 31) & 255) as u8)
            .collect::<Vec<_>>();
        assert_eq!(hex(&sha256(&bytes)), digest);
        for width in [1, 2, 7, 55, 64, 65, 127, 256] {
            let mut hash = Sha256::new();
            hash.update(&[]);
            for part in bytes.chunks(width) {
                hash.update(part);
                hash.update(&[]);
            }
            assert_eq!(
                hex(&hash.finalize()),
                digest,
                "length {length}, width {width}"
            );
        }
    }
}
