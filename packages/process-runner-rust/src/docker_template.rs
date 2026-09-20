//! Portable Docker content hashing and cache/build policy. Hosts supply canonical
//! paths, locale-sorted argument pairs, filesystem bytes and process results.
use crate::docker::{Text, context_args};
use mcp_oauth_rust::Sha256;
pub struct Entry<'a> {
    pub path: &'a [u16],
    pub bytes: &'a [u8],
}
fn utf8(hash: &mut Sha256, text: &[u16]) {
    let mut buffer = [0; 4];
    for point in char::decode_utf16(text.iter().copied()) {
        hash.update(
            point
                .unwrap_or(char::REPLACEMENT_CHARACTER)
                .encode_utf8(&mut buffer)
                .as_bytes(),
        );
    }
}
pub fn hash(
    dockerfile: &[u8],
    files: &[Entry<'_>],
    args: &[(Text, Text)],
    engine: &[u16],
) -> String {
    let mut hash = Sha256::new();
    hash.update(dockerfile);
    hash.update(&[0]);
    utf8(&mut hash, engine);
    hash.update(&[0]);
    for file in files {
        utf8(&mut hash, file.path);
        hash.update(&[0]);
        hash.update(file.bytes);
        hash.update(&[0]);
    }
    for (key, value) in args {
        utf8(&mut hash, key);
        hash.update(b"=");
        utf8(&mut hash, value);
        hash.update(&[0]);
    }
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn inside(relative: &[u16], absolute: bool) -> bool {
    relative.is_empty() || (!relative.starts_with(&[46, 46]) && !absolute)
}
pub struct Template {
    pub hash: String,
}
impl Template {
    pub fn new(hash: String) -> Self {
        Self { hash }
    }
    pub fn image(&self) -> String {
        format!("poe-code/local:{}", self.hash)
    }
    pub fn cached(&self, force: bool, image: Option<&[u16]>, inspect_exit_code: i32) -> bool {
        !force && image.is_some() && inspect_exit_code == 0
    }
    pub fn build_args(
        &self,
        engine: &[u16],
        context: Option<&[u16]>,
        dockerfile: &[u16],
        directory: &[u16],
        args: &[(Text, Text)],
    ) -> Vec<Text> {
        let mut argv = context_args(engine, context);
        argv.extend(["build", "--tag"].map(|text| text.encode_utf16().collect()));
        argv.push(self.image().encode_utf16().collect());
        argv.push("-f".encode_utf16().collect());
        argv.push(dockerfile.to_vec());
        for (key, value) in args {
            let mut pair = key.clone();
            pair.push(61);
            pair.extend(value);
            argv.push("--build-arg".encode_utf16().collect());
            argv.push(pair);
        }
        argv.push(directory.to_vec());
        argv
    }
}
