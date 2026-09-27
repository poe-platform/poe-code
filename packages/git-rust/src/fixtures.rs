use std::collections::BTreeMap;
use std::sync::OnceLock;

use crate::fs::MemoryFs;
use crate::utils::zlib::zlib_inflate;

const COMPRESSED_FIXTURES: &[u8] =
    include_bytes!("../fixtures/isomorphic-git-fixtures.bin.zlib");

#[derive(Debug, Clone)]
pub enum FixtureEntryKind {
    Dir { mode: u32 },
    File { mode: u32, blob_idx: usize },
    Symlink { mode: u32, target: String },
}

#[derive(Debug, Clone)]
pub struct FixtureArchive {
    pub blobs: Vec<Vec<u8>>,
    pub entries_by_fixture: BTreeMap<String, Vec<(String, FixtureEntryKind)>>,
}

static ARCHIVE: OnceLock<FixtureArchive> = OnceLock::new();

pub fn fixture_archive() -> &'static FixtureArchive {
    ARCHIVE.get_or_init(|| {
        let raw = zlib_inflate(COMPRESSED_FIXTURES).expect("Failed to inflate embedded fixtures");
        let mut pos = 0usize;

        let read_u8 = |p: &mut usize| -> u8 {
            let v = raw[*p];
            *p += 1;
            v
        };
        let read_u16 = |p: &mut usize| -> u16 {
            let v = u16::from_le_bytes([raw[*p], raw[*p + 1]]);
            *p += 2;
            v
        };
        let read_u32 = |p: &mut usize| -> u32 {
            let v = u32::from_le_bytes([raw[*p], raw[*p + 1], raw[*p + 2], raw[*p + 3]]);
            *p += 4;
            v
        };

        let blob_count = read_u32(&mut pos) as usize;
        let mut blobs = Vec::with_capacity(blob_count);
        for _ in 0..blob_count {
            let len = read_u32(&mut pos) as usize;
            blobs.push(raw[pos..pos + len].to_vec());
            pos += len;
        }

        let entry_count = read_u32(&mut pos) as usize;
        let mut entries_by_fixture: BTreeMap<String, Vec<(String, FixtureEntryKind)>> =
            BTreeMap::new();

        for _ in 0..entry_count {
            let kind_tag = read_u8(&mut pos);
            let mode = read_u32(&mut pos);
            let path_len = read_u16(&mut pos) as usize;
            let rel_path = String::from_utf8(raw[pos..pos + path_len].to_vec()).unwrap();
            pos += path_len;

            let kind = match kind_tag {
                0 => FixtureEntryKind::Dir { mode },
                1 => {
                    let blob_idx = read_u32(&mut pos) as usize;
                    FixtureEntryKind::File { mode, blob_idx }
                }
                2 => {
                    let target_len = read_u16(&mut pos) as usize;
                    let target = String::from_utf8(raw[pos..pos + target_len].to_vec()).unwrap();
                    pos += target_len;
                    FixtureEntryKind::Symlink { mode, target }
                }
                _ => unreachable!(),
            };

            let (top_fixture, inner_rel) = match rel_path.find('/') {
                Some(slash) => (rel_path[..slash].to_string(), rel_path[slash + 1..].to_string()),
                None => (rel_path.clone(), String::new()),
            };
            entries_by_fixture
                .entry(top_fixture)
                .or_default()
                .push((inner_rel, kind));
        }

        FixtureArchive {
            blobs,
            entries_by_fixture,
        }
    })
}

pub fn materialize_fixture_into(fs: &MemoryFs, fixture_name: &str, target_dir: &str) -> bool {
    let _ = fs.mkdir(target_dir);
    let archive = fixture_archive();
    let Some(entries) = archive.entries_by_fixture.get(fixture_name) else {
        return false;
    };
    for (rel, kind) in entries {
        let full = if rel.is_empty() {
            target_dir.to_string()
        } else {
            format!("{target_dir}/{rel}")
        };
        match kind {
            FixtureEntryKind::Dir { .. } => {
                let _ = fs.mkdir(&full);
            }
            FixtureEntryKind::File { mode, blob_idx } => {
                fs.write_with_mode(&full, &archive.blobs[*blob_idx], *mode);
            }
            FixtureEntryKind::Symlink { target, .. } => {
                let _ = fs.writelink(&full, target.as_bytes());
            }
        }
    }
    true
}

#[derive(Debug, Clone)]
pub struct FixtureEnv {
    pub fs: MemoryFs,
    pub dir: String,
    pub gitdir: String,
}

#[derive(Debug, Clone)]
pub struct SubmoduleFixtureEnv {
    pub fs: MemoryFs,
    pub dir: String,
    pub gitdir: String,
    pub gitdirsmfullpath: String,
}

pub fn make_fixture(fixture: &str) -> FixtureEnv {
    let fs = MemoryFs::new();
    let dir = format!("/tmp/fixture-{fixture}");
    let gitdir = format!("/tmp/fixture-{fixture}.git");
    materialize_fixture_into(&fs, fixture, &dir);
    materialize_fixture_into(&fs, &format!("{fixture}.git"), &gitdir);
    FixtureEnv { fs, dir, gitdir }
}

pub fn make_fixture_as_submodule(fixture: &str) -> SubmoduleFixtureEnv {
    let fs = MemoryFs::new();
    let dirsp = format!("/tmp/superproject-{fixture}");
    let gitdirsp = format!("{dirsp}/.git");
    materialize_fixture_into(&fs, "test-submodules.git", &gitdirsp);

    let modules_dir = format!("{gitdirsp}/modules");
    let _ = fs.mkdir(&modules_dir);
    let gitdirsmfullpath = format!("{modules_dir}/mysubmodule");
    materialize_fixture_into(&fs, &format!("{fixture}.git"), &gitdirsmfullpath);

    let official_submodule_dir = format!("{dirsp}/mysubmodule");
    materialize_fixture_into(&fs, fixture, &official_submodule_dir);

    let submodule_git_file = format!("{official_submodule_dir}/.git");
    fs.write_str(&submodule_git_file, "gitdir: ../.git/modules/mysubmodule\n");

    SubmoduleFixtureEnv {
        fs,
        dir: official_submodule_dir,
        gitdir: submodule_git_file,
        gitdirsmfullpath,
    }
}
