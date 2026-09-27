pub mod crc32;
pub mod delta;
pub mod sha1;
pub mod zlib;

use std::cmp::Ordering;
use std::collections::BTreeMap;

pub use crc32::{crc32, crc32_update};
pub use delta::apply_delta;
pub use sha1::{Sha1, from_hex, is_valid_oid_hex, shasum, shasum_bytes, shasum_range, to_hex};
pub use zlib::{adler32, inflate_raw_from, zlib_deflate, zlib_inflate, zlib_inflate_with_consumed};

#[derive(Debug, Clone, PartialEq)]
pub struct Author {
    pub name: String,
    pub email: String,
    pub timestamp: i64,
    pub timezone_offset: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PartialAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
    pub timestamp: Option<i64>,
    pub timezone_offset: Option<f64>,
}

pub fn parse_author(author: &str) -> Author {
    // Matches /^(.*) <(.*)> (.*) (.*)$/
    if let Some(lt_idx) = author.find(" <") {
        let name = author[..lt_idx].to_string();
        let rest = &author[lt_idx + 2..];
        if let Some(gt_idx) = rest.find("> ") {
            let email = rest[..gt_idx].to_string();
            let tail = &rest[gt_idx + 2..];
            if let Some(sp_idx) = tail.rfind(' ') {
                let ts_str = &tail[..sp_idx];
                let tz_str = &tail[sp_idx + 1..];
                let timestamp = ts_str.parse::<i64>().unwrap_or(0);
                let timezone_offset = parse_timezone_offset(tz_str);
                return Author {
                    name,
                    email,
                    timestamp,
                    timezone_offset,
                };
            }
        }
    }
    Author {
        name: author.to_string(),
        email: String::new(),
        timestamp: 0,
        timezone_offset: 0.0,
    }
}

pub fn parse_timezone_offset(offset: &str) -> f64 {
    let bytes = offset.as_bytes();
    if bytes.len() >= 5 && (bytes[0] == b'+' || bytes[0] == b'-') {
        let sign = if bytes[0] == b'+' { 1.0 } else { -1.0 };
        let hours = std::str::from_utf8(&bytes[1..3])
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let minutes = std::str::from_utf8(&bytes[3..5])
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let total = sign * (hours * 60.0 + minutes);
        return negate_except_for_zero(total);
    }
    0.0
}

fn negate_except_for_zero(n: f64) -> f64 {
    if n == 0.0 {
        n
    } else {
        -n
    }
}

pub fn format_author(author: &Author) -> String {
    let tz = format_timezone_offset(author.timezone_offset);
    format!("{} <{}> {} {}", author.name, author.email, author.timestamp, tz)
}

pub fn format_timezone_offset(minutes: f64) -> String {
    let negated = negate_except_for_zero(minutes);
    let sign_negative = if negated == 0.0 {
        negated.is_sign_negative()
    } else {
        negated < 0.0
    };
    let abs_min = minutes.abs().round() as i64;
    let hours = abs_min / 60;
    let rem_min = abs_min % 60;
    let sign_char = if sign_negative { '-' } else { '+' };
    format!("{sign_char}{hours:02}{rem_min:02}")
}

fn get_windows_drive_prefix(path: &str) -> Option<&str> {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        Some(&path[..2])
    } else {
        None
    }
}

fn normalize_string(path: &str, allow_above_root: bool) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if let Some(&last) = parts.last()
                && last != ".." {
                    parts.pop();
                    continue;
                }
            if allow_above_root {
                parts.push("..");
            }
        } else {
            parts.push(seg);
        }
    }
    parts.join("/")
}

pub fn normalize_path(raw_path: &str) -> String {
    if raw_path.is_empty() {
        return ".".to_string();
    }
    let path = raw_path.replace('\\', "/");
    let drive_prefix = get_windows_drive_prefix(&path);
    let is_absolute = path.starts_with('/')
        || (drive_prefix.is_some() && path.as_bytes().get(2) == Some(&b'/'));
    let trailing_separator = path.ends_with('/');
    let path_body = if drive_prefix.is_some() {
        &path[2..]
    } else {
        &path[..]
    };
    let mut normalized = normalize_string(path_body, !is_absolute);
    if normalized.is_empty() {
        let root = if let Some(dp) = drive_prefix {
            if is_absolute {
                format!("{dp}/")
            } else {
                dp.to_string()
            }
        } else if is_absolute {
            "/".to_string()
        } else {
            ".".to_string()
        };
        return if trailing_separator && !is_absolute {
            format!("{root}/")
        } else {
            root
        };
    }
    if trailing_separator {
        normalized.push('/');
    }
    if let Some(dp) = drive_prefix {
        if is_absolute {
            format!("{dp}/{normalized}")
        } else {
            format!("{dp}{normalized}")
        }
    } else if is_absolute {
        format!("/{normalized}")
    } else {
        normalized
    }
}

pub fn join(args: &[&str]) -> String {
    if args.is_empty() {
        return ".".to_string();
    }
    let mut joined: Option<String> = None;
    for raw in args {
        let arg = raw.replace('\\', "/");
        if arg.is_empty() {
            continue;
        }
        let bytes = arg.as_bytes();
        let is_win_drive_abs =
            bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
        if is_win_drive_abs {
            joined = Some(arg);
        } else if let Some(ref mut acc) = joined {
            acc.push('/');
            acc.push_str(&arg);
        } else {
            joined = Some(arg);
        }
    }
    match joined {
        None => ".".to_string(),
        Some(s) => normalize_path(&s),
    }
}

pub fn dirname(path: &str) -> String {
    let p = path.trim_end_matches('/');
    if p.is_empty() {
        if path.starts_with('/') {
            return "/".to_string();
        }
        return ".".to_string();
    }
    match p.rfind('/') {
        None => ".".to_string(),
        Some(0) => "/".to_string(),
        Some(idx) => p[..idx].to_string(),
    }
}

pub fn basename(path: &str) -> String {
    let p = path.trim_end_matches('/');
    if p.is_empty() {
        return String::new();
    }
    match p.rfind('/') {
        None => p.to_string(),
        Some(idx) => p[idx + 1..].to_string(),
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExtractedAuth {
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedUrlAuth {
    pub url: String,
    pub auth: ExtractedAuth,
}

pub fn extract_auth_from_url(url: &str) -> ExtractedUrlAuth {
    let lower = url.to_ascii_lowercase();
    let scheme_len = if lower.starts_with("http://") {
        7
    } else if lower.starts_with("https://") {
        8
    } else {
        return ExtractedUrlAuth {
            url: url.to_string(),
            auth: ExtractedAuth::default(),
        };
    };

    let after_scheme = &url[scheme_len..];
    let authority_end = after_scheme
        .find(['/', '?', '#'])
        .unwrap_or(after_scheme.len());
    let authority = &after_scheme[..authority_end];

    let Some(at_pos) = authority.rfind('@') else {
        return ExtractedUrlAuth {
            url: url.to_string(),
            auth: ExtractedAuth::default(),
        };
    };

    let userpass = &authority[..at_pos];
    let rest_after_at = &after_scheme[at_pos + 1..];
    let stripped_url = format!("{}{}", &url[..scheme_len], rest_after_at);

    let (raw_user, raw_pass) = match userpass.find(':') {
        Some(colon) => (&userpass[..colon], Some(&userpass[colon + 1..])),
        None => (userpass, None),
    };

    let can_parse_as_url = is_standard_url_authority(&after_scheme[at_pos + 1..authority_end]);
    let username = if can_parse_as_url {
        percent_decode_or_raw(raw_user)
    } else {
        raw_user.to_string()
    };
    let password = raw_pass.map(|p| {
        if can_parse_as_url {
            percent_decode_or_raw(p)
        } else {
            p.to_string()
        }
    });

    ExtractedUrlAuth {
        url: stripped_url,
        auth: ExtractedAuth {
            username: Some(username),
            password,
        },
    }
}

fn is_standard_url_authority(host_port: &str) -> bool {
    if host_port.is_empty() {
        return false;
    }
    if let Some(colon) = host_port.rfind(':') {
        let port_str = &host_port[colon + 1..];
        if !port_str.is_empty() && port_str.parse::<u16>().is_err() {
            return false;
        }
    }
    true
}

fn percent_decode_or_raw(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return input.to_string();
            }
            let hi = match bytes[i + 1] {
                b'0'..=b'9' => bytes[i + 1] - b'0',
                b'a'..=b'f' => bytes[i + 1] - b'a' + 10,
                b'A'..=b'F' => bytes[i + 1] - b'A' + 10,
                _ => return input.to_string(),
            };
            let lo = match bytes[i + 2] {
                b'0'..=b'9' => bytes[i + 2] - b'0',
                b'a'..=b'f' => bytes[i + 2] - b'a' + 10,
                b'A'..=b'F' => bytes[i + 2] - b'A' + 10,
                _ => return input.to_string(),
            };
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerRef {
    pub r#ref: String,
    pub oid: String,
    pub target: Option<String>,
    pub peeled: Option<String>,
}

pub fn format_info_refs(
    refs: &[(String, String)],
    symrefs: &BTreeMap<String, String>,
    prefix: &str,
    include_symrefs: bool,
    peel_tags: bool,
) -> Vec<ServerRef> {
    let mut out: Vec<ServerRef> = Vec::new();
    for (key, value) in refs {
        if !prefix.is_empty() && !key.starts_with(prefix) {
            continue;
        }
        if let Some(stripped) = key.strip_suffix("^{}") {
            if peel_tags
                && let Some(target_ref) = out.iter_mut().rev().find(|r| r.r#ref == stripped) {
                    target_ref.peeled = Some(value.clone());
                }
            continue;
        }
        let target = if include_symrefs {
            symrefs.get(key).cloned()
        } else {
            None
        };
        out.push(ServerRef {
            r#ref: key.clone(),
            oid: value.clone(),
            target,
            peeled: None,
        });
    }
    out
}

pub fn split_lines(input: &str) -> Vec<String> {
    if input.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let bytes = input.as_bytes();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                out.push(input[start..i + 2].to_string());
                i += 2;
                start = i;
            } else {
                out.push(input[start..i + 1].to_string());
                i += 1;
                start = i;
            }
        } else if bytes[i] == b'\n' {
            out.push(input[start..i + 1].to_string());
            i += 1;
            start = i;
        } else {
            i += 1;
        }
    }
    if start < bytes.len() {
        out.push(input[start..].to_string());
    }
    out
}

pub fn is_binary(buffer: &[u8]) -> bool {
    const MAX_XDIFF_SIZE: usize = 1024 * 1024 * 1023;
    if buffer.len() > MAX_XDIFF_SIZE {
        return true;
    }
    let check_len = buffer.len().min(8000);
    buffer[..check_len].contains(&0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryNode<M: Clone> {
    pub node_type: String, // "tree" or "blob"
    pub fullpath: String,
    pub basename: String,
    pub parent: Option<String>,
    pub children: Vec<String>,
    pub metadata: Option<M>,
}

pub fn flat_file_list_to_directory_structure<M: Clone>(
    files: &[(String, M)],
) -> BTreeMap<String, DirectoryNode<M>> {
    let mut inodes: BTreeMap<String, DirectoryNode<M>> = BTreeMap::new();

    fn ensure_dir<M: Clone>(name: &str, inodes: &mut BTreeMap<String, DirectoryNode<M>>) {
        if !inodes.contains_key(name) {
            let parent_name = dirname(name);
            let dir = DirectoryNode {
                node_type: "tree".to_string(),
                fullpath: name.to_string(),
                basename: basename(name),
                parent: Some(parent_name.clone()),
                children: Vec::new(),
                metadata: None,
            };
            inodes.insert(name.to_string(), dir);
            ensure_dir(&parent_name, inodes);
            if parent_name != name
                && let Some(p) = inodes.get_mut(&parent_name)
                    && !p.children.contains(&name.to_string()) {
                        p.children.push(name.to_string());
                    }
        }
    }

    ensure_dir(".", &mut inodes);
    for (file_path, meta) in files {
        if !inodes.contains_key(file_path) {
            let parent_name = dirname(file_path);
            ensure_dir(&parent_name, &mut inodes);
            let file_node = DirectoryNode {
                node_type: "blob".to_string(),
                fullpath: file_path.clone(),
                basename: basename(file_path),
                parent: Some(parent_name.clone()),
                children: Vec::new(),
                metadata: Some(meta.clone()),
            };
            inodes.insert(file_path.clone(), file_node);
            if let Some(p) = inodes.get_mut(&parent_name) {
                p.children.push(file_path.clone());
            }
        }
    }
    inodes
}

pub fn clean_git_ref(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\') {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    while out.contains("..") {
        out = out.replace("..", ".");
    }
    while out.contains("//") {
        out = out.replace("//", "/");
    }
    while out.contains("@{") {
        out = out.replace("@{", "@-");
    }
    out = out.trim_matches('/').trim_matches('.').to_string();
    if out.ends_with(".lock") {
        out.truncate(out.len() - 5);
    }
    out
}

pub fn is_valid_ref(name: &str, onelevel: bool) -> bool {
    if name.is_empty() || name == "@" {
        return false;
    }
    if name.starts_with('/') || name.ends_with('/') || name.ends_with('.') {
        return false;
    }
    if name.contains("..") || name.contains("//") || name.contains("@{") {
        return false;
    }
    if !onelevel && !name.contains('/') && name != "HEAD" && name != "FETCH_HEAD" && name != "MERGE_HEAD" && name != "ORIG_HEAD" {
        // Note: branch/tag names checked with onelevel=true allow single segment
    }
    for ch in name.chars() {
        if ch.is_control() || matches!(ch, ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\') {
            return false;
        }
    }
    for part in name.split('/') {
        if part.is_empty() || part.starts_with('.') || part.ends_with(".lock") {
            return false;
        }
    }
    true
}

pub fn compare_strings(a: &str, b: &str) -> Ordering {
    a.as_bytes().cmp(b.as_bytes())
}

pub fn compare_ref_names(a: &str, b: &str) -> Ordering {
    let a_trimmed = a.strip_suffix("^{}").unwrap_or(a);
    let b_trimmed = b.strip_suffix("^{}").unwrap_or(b);
    match compare_strings(a_trimmed, b_trimmed) {
        Ordering::Equal => a.len().cmp(&b.len()),
        other => other,
    }
}

pub fn compare_tree_entry_path(a_name: &str, a_mode: &str, b_name: &str, b_mode: &str) -> Ordering {
    let a_key = if a_mode == "040000" || a_mode == "40000" {
        format!("{a_name}/")
    } else {
        a_name.to_string()
    };
    let b_key = if b_mode == "040000" || b_mode == "40000" {
        format!("{b_name}/")
    } else {
        b_name.to_string()
    };
    compare_strings(&a_key, &b_key)
}

pub fn mode2type(mode: u32) -> &'static str {
    match mode {
        0o040000 => "tree",
        0o100644 | 0o100755 => "blob",
        0o120000 => "blob",
        0o160000 => "commit",
        _ => "blob",
    }
}

pub fn normalize_mode(mode: u32) -> u32 {
    if mode == 0o040000 || (mode & 0o170000) == 0o040000 {
        return 0o040000;
    }
    if (mode & 0o170000) == 0o120000 {
        return 0o120000;
    }
    if (mode & 0o170000) == 0o160000 {
        return 0o160000;
    }
    if (mode & 0o111) != 0 {
        0o100755
    } else {
        0o100644
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeFileResult {
    pub clean_merge: bool,
    pub merged_text: String,
}

pub fn merge_file(branches: [&str; 3], contents: [&str; 3]) -> MergeFileResult {
    let our_name = branches[1];
    let their_name = branches[2];

    let base_lines = split_lines_keep_empty(contents[0]);
    let our_lines = split_lines_keep_empty(contents[1]);
    let their_lines = split_lines_keep_empty(contents[2]);

    let matches_oa = lcs_indices(&base_lines, &our_lines);
    let matches_ob = lcs_indices(&base_lines, &their_lines);

    // Map base index -> (our_index, their_index) where both match base
    let mut oa_map = vec![None; base_lines.len()];
    for (o_idx, a_idx) in matches_oa {
        oa_map[o_idx] = Some(a_idx);
    }
    let mut ob_map = vec![None; base_lines.len()];
    for (o_idx, b_idx) in matches_ob {
        ob_map[o_idx] = Some(b_idx);
    }

    let mut merged_text = String::new();
    let mut clean_merge = true;

    let mut o_cur = 0;
    let mut a_cur = 0;
    let mut b_cur = 0;

    while o_cur < base_lines.len() {
        if let (Some(a_sync), Some(b_sync)) = (oa_map[o_cur], ob_map[o_cur])
            && a_sync >= a_cur && b_sync >= b_cur {
                if a_sync > a_cur || b_sync > b_cur {
                    // Unstable hunk before sync line
                    emit_hunk(
                        &base_lines[o_cur..o_cur],
                        &our_lines[a_cur..a_sync],
                        &their_lines[b_cur..b_sync],
                        our_name,
                        their_name,
                        &mut merged_text,
                        &mut clean_merge,
                    );
                }
                merged_text.push_str(base_lines[o_cur]);
                o_cur += 1;
                a_cur = a_sync + 1;
                b_cur = b_sync + 1;
                continue;
            }
        // Find next sync point where both oa_map and ob_map exist and are monotonic
        let mut next_sync = None;
        for probe in (o_cur + 1)..base_lines.len() {
            if let (Some(a_p), Some(b_p)) = (oa_map[probe], ob_map[probe])
                && a_p >= a_cur && b_p >= b_cur {
                    next_sync = Some((probe, a_p, b_p));
                    break;
                }
        }
        if let Some((o_next, a_next, b_next)) = next_sync {
            emit_hunk(
                &base_lines[o_cur..o_next],
                &our_lines[a_cur..a_next],
                &their_lines[b_cur..b_next],
                our_name,
                their_name,
                &mut merged_text,
                &mut clean_merge,
            );
            o_cur = o_next;
            a_cur = a_next;
            b_cur = b_next;
        } else {
            break;
        }
    }

    if o_cur < base_lines.len() || a_cur < our_lines.len() || b_cur < their_lines.len() {
        emit_hunk(
            &base_lines[o_cur..],
            &our_lines[a_cur..],
            &their_lines[b_cur..],
            our_name,
            their_name,
            &mut merged_text,
            &mut clean_merge,
        );
    }

    MergeFileResult {
        clean_merge,
        merged_text,
    }
}

fn emit_hunk(
    base: &[&str],
    ours: &[&str],
    theirs: &[&str],
    our_name: &str,
    their_name: &str,
    merged_text: &mut String,
    clean_merge: &mut bool,
) {
    if ours == base {
        for &line in theirs {
            merged_text.push_str(line);
        }
    } else if theirs == base || ours == theirs {
        for &line in ours {
            merged_text.push_str(line);
        }
    } else {
        *clean_merge = false;
        merged_text.push_str(&format!("<<<<<<< {our_name}\n"));
        for &line in ours {
            merged_text.push_str(line);
        }
        merged_text.push_str("=======\n");
        for &line in theirs {
            merged_text.push_str(line);
        }
        merged_text.push_str(&format!(">>>>>>> {their_name}\n"));
    }
}

fn split_lines_keep_empty(s: &str) -> Vec<&str> {
    if s.is_empty() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    let bytes = s.as_bytes();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            lines.push(&s[start..=i]);
            i += 1;
            start = i;
        } else {
            i += 1;
        }
    }
    if start < bytes.len() {
        lines.push(&s[start..]);
    }
    lines
}

fn lcs_indices(a: &[&str], b: &[&str]) -> Vec<(usize, usize)> {
    let n = a.len();
    let m = b.len();
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            if a[i] == b[j] {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = dp[i + 1][j].max(dp[i][j + 1]);
            }
        }
    }
    let mut i = 0;
    let mut j = 0;
    let mut pairs = Vec::new();
    while i < n && j < m {
        if a[i] == b[j] {
            pairs.push((i, j));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    pairs
}
