use std::collections::BTreeMap;

use crate::errors::GitError;
use crate::fs::{discover_gitdir, MemoryFs};
use crate::models::git_object::UnwrappedObject;
use crate::models::{
    CommitObject, GitAnnotatedTag, GitCommit, GitObject, GitPackIndex, GitTree, TagObject,
    TreeEntry,
};
use crate::utils::{join, shasum, zlib_deflate, zlib_inflate};

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedObject {
    Blob(Vec<u8>),
    BlobString(String),
    Commit(CommitObject),
    Tree(Vec<TreeEntry>),
    Tag(TagObject),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadObjectResult {
    pub oid: String,
    pub obj_type: String,
    pub format: String,
    pub object: Vec<u8>,
    pub parsed: Option<ParsedObject>,
    pub source: Option<String>,
}

pub fn read_object_loose(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
) -> Option<(Vec<u8>, String)> {
    if oid.len() != 40 {
        return None;
    }
    let source = format!("objects/{}/{}", &oid[0..2], &oid[2..]);
    let filepath = join(&[gitdir, &source]);
    let bytes = fs.read(&filepath)?;
    Some((bytes, source))
}

pub fn load_pack_indexes(
    fs: &MemoryFs,
    gitdir: &str,
) -> Result<Vec<(String, GitPackIndex)>, GitError> {
    let pack_dir = join(&[gitdir, "objects/pack"]);
    let Ok(entries) = fs.readdir(&pack_dir) else {
        return Ok(Vec::new());
    };
    let mut packfiles: Vec<String> = entries
        .into_iter()
        .filter(|name| name.ends_with(".pack"))
        .collect();
    packfiles.sort();

    let mut result = Vec::new();
    for pack_name in packfiles {
        let idx_name = pack_name.trim_end_matches(".pack").to_string() + ".idx";
        let pack_path = join(&[&pack_dir, &pack_name]);
        let idx_path = join(&[&pack_dir, &idx_name]);
        let Some(pack_bytes) = fs.read(&pack_path) else {
            continue;
        };
        let get_ext = |ext_oid: &str| -> Result<UnwrappedObject, GitError> {
            let r = _read_object(fs, gitdir, ext_oid, "content")?;
            Ok(UnwrappedObject {
                object_type: r.obj_type,
                object: r.object,
            })
        };
        let mut p = if let Some(idx_bytes) = fs.read(&idx_path) {
            match GitPackIndex::from_idx(&idx_bytes)? {
                Some(mut idx) => {
                    idx.load(pack_bytes);
                    idx
                }
                None => GitPackIndex::from_pack(&pack_bytes, Some(&get_ext))?,
            }
        } else {
            GitPackIndex::from_pack(&pack_bytes, Some(&get_ext))?
        };
        if p.pack.is_none() {
            if let Some(pb) = fs.read(&pack_path) {
                p.load(pb);
            }
        }
        let source = format!("objects/pack/{pack_name}");
        result.push((source, p));
    }
    Ok(result)
}

pub fn read_object_packed(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
) -> Result<Option<ReadObjectResult>, GitError> {
    let mut packs = load_pack_indexes(fs, gitdir)?;
    let get_ext = |ext_oid: &str| -> Result<UnwrappedObject, GitError> {
        let r = _read_object(fs, gitdir, ext_oid, "content")?;
        Ok(UnwrappedObject {
            object_type: r.obj_type,
            object: r.object,
        })
    };
    for (source, pack) in &mut packs {
        if pack.offsets.contains_key(oid) {
            let res = pack.read_with_external(oid, Some(&get_ext))?;
            return Ok(Some(ReadObjectResult {
                oid: oid.to_string(),
                obj_type: res.object_type,
                format: "content".to_string(),
                object: res.object,
                parsed: None,
                source: Some(source.clone()),
            }));
        }
    }
    Ok(None)
}

pub fn _read_object(
    fs: &MemoryFs,
    raw_gitdir: &str,
    oid: &str,
    format: &str,
) -> Result<ReadObjectResult, GitError> {
    let gitdir_buf = discover_gitdir(fs, raw_gitdir);
    let gitdir = gitdir_buf.as_str();
    if !matches!(format, "deflated" | "wrapped" | "content") {
        return Err(GitError::internal(&format!(
            "invalid requested format \"{format}\""
        )));
    }

    let mut result: Option<ReadObjectResult> = None;
    if oid == "4b825dc642cb6eb9a060e54bf8d69288fbee4904" {
        result = Some(ReadObjectResult {
            oid: oid.to_string(),
            obj_type: "wrapped".to_string(),
            format: "wrapped".to_string(),
            object: b"tree 0\0".to_vec(),
            parsed: None,
            source: None,
        });
    }

    if result.is_none() {
        if let Some((bytes, source)) = read_object_loose(fs, gitdir, oid) {
            result = Some(ReadObjectResult {
                oid: oid.to_string(),
                obj_type: "deflated".to_string(),
                format: "deflated".to_string(),
                object: bytes,
                parsed: None,
                source: Some(source),
            });
        }
    }

    if result.is_none() {
        if let Some(packed) = read_object_packed(fs, gitdir, oid)? {
            return Ok(packed);
        }
        return Err(GitError::not_found(oid));
    }

    let mut res = result.unwrap();
    if format == "deflated" {
        return Ok(res);
    }

    if res.format == "deflated" {
        res.object = zlib_inflate(&res.object)?;
        res.format = "wrapped".to_string();
        res.obj_type = "wrapped".to_string();
    }

    if format == "wrapped" {
        return Ok(res);
    }

    let sha = shasum(&res.object);
    if sha != oid {
        return Err(GitError::internal(&format!(
            "SHA check failed! Expected {oid}, computed {sha}"
        )));
    }
    let unwrapped = GitObject::unwrap(&res.object)?;
    res.obj_type = unwrapped.object_type;
    res.object = unwrapped.object;
    res.format = "content".to_string();
    Ok(res)
}

pub fn resolve_tree(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
) -> Result<(String, GitTree), GitError> {
    if oid == "4b825dc642cb6eb9a060e54bf8d69288fbee4904" {
        return Ok((oid.to_string(), GitTree::from_entries(Vec::new())?));
    }
    let obj = _read_object(fs, gitdir, oid, "content")?;
    match obj.obj_type.as_str() {
        "tag" => {
            let tag = GitAnnotatedTag::from_bytes(&obj.object).parse();
            resolve_tree(fs, gitdir, &tag.object)
        }
        "commit" => {
            let commit = GitCommit::from_bytes(&obj.object).parse();
            resolve_tree(fs, gitdir, &commit.tree)
        }
        "tree" => {
            let tree = GitTree::from_bytes(&obj.object)?;
            Ok((oid.to_string(), tree))
        }
        other => Err(GitError::object_type(oid, other, "tree", None)),
    }
}

pub fn resolve_filepath_entry(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    filepath: &str,
) -> Result<TreeEntry, GitError> {
    if filepath.starts_with('/') {
        return Err(GitError::invalid_filepath(Some("leading-slash")));
    } else if filepath.ends_with('/') {
        return Err(GitError::invalid_filepath(Some("trailing-slash")));
    }
    let root_oid = oid.to_string();
    let (tree_oid, tree) = resolve_tree(fs, gitdir, oid)?;
    if filepath.is_empty() {
        return Ok(TreeEntry {
            mode: "040000".to_string(),
            path: String::new(),
            oid: tree_oid,
            entry_type: "tree".to_string(),
        });
    }
    let parts: Vec<&str> = filepath.split('/').collect();
    resolve_filepath_recursive(fs, gitdir, &tree, &parts, &root_oid, filepath)
}

fn resolve_filepath_recursive(
    fs: &MemoryFs,
    gitdir: &str,
    tree: &GitTree,
    parts: &[&str],
    root_oid: &str,
    filepath: &str,
) -> Result<TreeEntry, GitError> {
    let name = parts[0];
    let rest = &parts[1..];
    for entry in tree.entries() {
        if entry.path == name {
            if rest.is_empty() {
                return Ok(entry.clone());
            } else {
                let sub = _read_object(fs, gitdir, &entry.oid, "content")?;
                if sub.obj_type != "tree" {
                    return Err(GitError::object_type(
                        root_oid,
                        &sub.obj_type,
                        "tree",
                        Some(filepath),
                    ));
                }
                let subtree = GitTree::from_bytes(&sub.object)?;
                return resolve_filepath_recursive(fs, gitdir, &subtree, rest, root_oid, filepath);
            }
        }
    }
    Err(GitError::not_found(&format!(
        "file or directory found at \"{root_oid}:{filepath}\""
    )))
}

pub fn resolve_filepath(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    filepath: &str,
) -> Result<String, GitError> {
    Ok(resolve_filepath_entry(fs, gitdir, oid, filepath)?.oid)
}

pub fn read_object(
    fs: &MemoryFs,
    gitdir: &str,
    oid: &str,
    format: Option<&str>,
    filepath: Option<&str>,
    encoding: Option<&str>,
) -> Result<ReadObjectResult, GitError> {
    let requested_format = format.unwrap_or("parsed");
    let resolved_oid = if let Some(fp) = filepath {
        resolve_filepath(fs, gitdir, oid, fp)?
    } else {
        oid.to_string()
    };

    let storage_format = if requested_format == "parsed" {
        "content"
    } else {
        requested_format
    };

    let mut result = _read_object(fs, gitdir, &resolved_oid, storage_format)?;
    result.oid = resolved_oid;

    if requested_format == "parsed" {
        match result.obj_type.as_str() {
            "commit" => {
                result.parsed = Some(ParsedObject::Commit(
                    GitCommit::from_bytes(&result.object).parse(),
                ));
                result.format = "parsed".to_string();
            }
            "tree" => {
                result.parsed = Some(ParsedObject::Tree(
                    GitTree::from_bytes(&result.object)?.entries().to_vec(),
                ));
                result.format = "parsed".to_string();
            }
            "tag" => {
                result.parsed = Some(ParsedObject::Tag(
                    GitAnnotatedTag::from_bytes(&result.object).parse(),
                ));
                result.format = "parsed".to_string();
            }
            "blob" => {
                if let Some(enc) = encoding {
                    if enc.eq_ignore_ascii_case("utf8") || enc.eq_ignore_ascii_case("utf-8") {
                        let s = String::from_utf8_lossy(&result.object).into_owned();
                        result.parsed = Some(ParsedObject::BlobString(s));
                        result.format = "parsed".to_string();
                    } else {
                        return Err(GitError::internal(&format!("Unsupported encoding: {enc}")));
                    }
                } else {
                    result.parsed = Some(ParsedObject::Blob(result.object.clone()));
                    result.format = "content".to_string();
                }
            }
            other => {
                return Err(GitError::object_type(
                    &result.oid,
                    other,
                    "commit|blob|tree|tag",
                    None,
                ));
            }
        }
    }

    Ok(result)
}

pub fn _write_object(
    fs: &MemoryFs,
    raw_gitdir: &str,
    obj_type: &str,
    object: &[u8],
    format: &str,
    oid_override: Option<&str>,
    dry_run: bool,
) -> Result<String, GitError> {
    let gitdir_buf = discover_gitdir(fs, raw_gitdir);
    let gitdir = gitdir_buf.as_str();
    let (deflated_bytes, oid) = if format == "deflated" {
        let oid = match oid_override {
            Some(o) => o.to_string(),
            None => {
                let inflated = zlib_inflate(object)?;
                shasum(&inflated)
            }
        };
        (object.to_vec(), oid)
    } else {
        let wrapped = if format == "wrapped" {
            object.to_vec()
        } else {
            GitObject::wrap(obj_type, object)
        };
        let computed_oid = shasum(&wrapped);
        let compressed = zlib_deflate(&wrapped);
        (compressed, computed_oid)
    };

    if !dry_run {
        let source = format!("objects/{}/{}", &oid[0..2], &oid[2..]);
        let filepath = join(&[gitdir, &source]);
        if !fs.exists(&filepath) {
            fs.write(&filepath, &deflated_bytes);
        }
    }
    Ok(oid)
}

#[allow(clippy::too_many_arguments)]
pub fn write_object(
    fs: &MemoryFs,
    gitdir: &str,
    obj_type: &str,
    format: Option<&str>,
    content_bytes: Option<&[u8]>,
    parsed: Option<&ParsedObject>,
    oid_override: Option<&str>,
    encoding: Option<&str>,
    dry_run: bool,
) -> Result<String, GitError> {
    let fmt = format.unwrap_or("parsed");
    let raw_bytes: Vec<u8> = if fmt == "parsed" {
        match (obj_type, parsed, content_bytes) {
            ("commit", Some(ParsedObject::Commit(c)), _) => GitCommit::from_object(c).to_object(),
            ("tree", Some(ParsedObject::Tree(entries)), _) => {
                GitTree::from_entries(entries.clone())?.to_object()?
            }
            ("tag", Some(ParsedObject::Tag(t)), _) => GitAnnotatedTag::from_object(t).to_object(),
            ("blob", Some(ParsedObject::Blob(b)), _) => b.clone(),
            ("blob", Some(ParsedObject::BlobString(s)), _) => s.as_bytes().to_vec(),
            ("blob", None, Some(b)) => {
                let _ = encoding;
                b.to_vec()
            }
            _ => {
                if let Some(b) = content_bytes {
                    b.to_vec()
                } else {
                    return Err(GitError::object_type(
                        "",
                        obj_type,
                        "blob|commit|tag|tree",
                        None,
                    ));
                }
            }
        }
    } else {
        content_bytes.unwrap_or(&[]).to_vec()
    };

    let storage_fmt = if fmt == "parsed" { "content" } else { fmt };
    _write_object(
        fs,
        gitdir,
        obj_type,
        &raw_bytes,
        storage_fmt,
        oid_override,
        dry_run,
    )
}

pub fn has_object(fs: &MemoryFs, raw_gitdir: &str, oid: &str) -> Result<bool, GitError> {
    let gitdir_buf = discover_gitdir(fs, raw_gitdir);
    let gitdir = gitdir_buf.as_str();
    if oid == "4b825dc642cb6eb9a060e54bf8d69288fbee4904" {
        return Ok(true);
    }
    if read_object_loose(fs, gitdir, oid).is_some() {
        return Ok(true);
    }
    let packs = load_pack_indexes(fs, gitdir)?;
    for (_source, pack) in packs {
        if pack.offsets.contains_key(oid) {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn expand_oid(fs: &MemoryFs, raw_gitdir: &str, short: &str) -> Result<String, GitError> {
    let gitdir_buf = discover_gitdir(fs, raw_gitdir);
    let gitdir = gitdir_buf.as_str();
    let mut results: Vec<String> = Vec::new();
    if short.len() >= 2 {
        let prefix_dir = join(&[gitdir, "objects", &short[0..2]]);
        if let Ok(entries) = fs.readdir(&prefix_dir) {
            let suffix_prefix = &short[2..];
            for entry in entries {
                if entry.starts_with(suffix_prefix) {
                    let full = format!("{}{}", &short[0..2], entry);
                    if !results.contains(&full) {
                        results.push(full);
                    }
                }
            }
        }
    }

    let packs = load_pack_indexes(fs, gitdir)?;
    for (_source, pack) in packs {
        for oid in &pack.hashes {
            if oid.starts_with(short) && !results.contains(oid) {
                results.push(oid.clone());
            }
        }
    }

    match results.len() {
        1 => Ok(results.remove(0)),
        0 => Err(GitError::not_found(&format!(
            "an object matching \"{short}\""
        ))),
        _ => Err(GitError::ambiguous("oids", short, results)),
    }
}

pub fn hash_object(obj_type: &str, object: &[u8]) -> String {
    let wrapped = GitObject::wrap(obj_type, object);
    shasum(&wrapped)
}

pub fn list_pack_and_loose_objects(fs: &MemoryFs, gitdir: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    if let Ok(packs) = load_pack_indexes(fs, gitdir) {
        for (source, pack) in packs {
            for oid in pack.hashes {
                out.insert(oid, source.clone());
            }
        }
    }
    out
}
