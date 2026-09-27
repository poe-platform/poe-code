use std::collections::{BTreeMap, BTreeSet};

use crate::errors::GitError;
use crate::models::{GitPktLine, GitSideBand, PktLineItem, PktLineReader};
use crate::utils::ServerRef;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefsAdResponse {
    V1 {
        protocol_version: u8,
        capabilities: BTreeSet<String>,
        refs: BTreeMap<String, String>,
        symrefs: BTreeMap<String, String>,
    },
    V2 {
        protocol_version: u8,
        capabilities2: BTreeMap<String, Option<String>>,
    },
}

pub fn parse_refs_ad_response(stream: &[u8], service: &str) -> Result<RefsAdResponse, GitError> {
    let mut reader = GitPktLine::stream_reader(stream);
    let mut first = reader.read();
    while first == PktLineItem::Flush || first == PktLineItem::Delim {
        first = reader.read();
    }
    let PktLineItem::Line(line_one_bytes) = first else {
        return Err(GitError::empty_server_response());
    };
    let line_one = String::from_utf8_lossy(&line_one_bytes).to_string();
    if line_one.contains("version 2") {
        return Ok(parse_capabilities_v2(&mut reader));
    }
    let expected_service = format!("# service={service}");
    if line_one.trim_end_matches('\n') != expected_service {
        return Err(GitError::parse(&format!("{expected_service}\\n"), &line_one));
    }

    let mut second = reader.read();
    while second == PktLineItem::Flush || second == PktLineItem::Delim {
        second = reader.read();
    }
    let mut capabilities = BTreeSet::new();
    let mut refs = BTreeMap::new();
    let mut symrefs = BTreeMap::new();

    let PktLineItem::Line(line_two_bytes) = second else {
        return Ok(RefsAdResponse::V1 {
            protocol_version: 1,
            capabilities,
            refs,
            symrefs,
        });
    };
    let line_two = String::from_utf8_lossy(&line_two_bytes).to_string();
    if line_two.contains("version 2") {
        return Ok(parse_capabilities_v2(&mut reader));
    }

    let (first_ref, caps_line) = split_and_assert(&line_two, '\0', "\\x00")?;
    for cap in caps_line.split(' ') {
        if !cap.is_empty() {
            capabilities.insert(cap.to_string());
        }
    }
    if first_ref != "0000000000000000000000000000000000000000 capabilities^{}" {
        let (oid, name) = split_and_assert(&first_ref, ' ', " ")?;
        refs.insert(name, oid);
        loop {
            match reader.read() {
                PktLineItem::Eof => break,
                PktLineItem::Flush | PktLineItem::Delim => continue,
                PktLineItem::Line(bytes) => {
                    let s = String::from_utf8_lossy(&bytes);
                    let (oid, name) = split_and_assert(&s, ' ', " ")?;
                    refs.insert(name, oid);
                }
            }
        }
    }
    for cap in &capabilities {
        if let Some(rest) = cap.strip_prefix("symref=") {
            if let Some(colon) = rest.find(':') {
                symrefs.insert(rest[..colon].to_string(), rest[colon + 1..].to_string());
            }
        }
    }
    Ok(RefsAdResponse::V1 {
        protocol_version: 1,
        capabilities,
        refs,
        symrefs,
    })
}

fn split_and_assert(line: &str, sep: char, expected: &str) -> Result<(String, String), GitError> {
    let trimmed = line.trim();
    let parts: Vec<&str> = trimmed.split(sep).collect();
    if parts.len() != 2 {
        return Err(GitError::parse(
            &format!("Two strings separated by '{expected}'"),
            line,
        ));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}

pub fn parse_capabilities_v2(reader: &mut PktLineReader) -> RefsAdResponse {
    let mut capabilities2 = BTreeMap::new();
    loop {
        match reader.read() {
            PktLineItem::Eof => break,
            PktLineItem::Flush | PktLineItem::Delim => continue,
            PktLineItem::Line(bytes) => {
                let line = String::from_utf8_lossy(&bytes)
                    .trim_end_matches('\n')
                    .to_string();
                if let Some(eq) = line.find('=') {
                    capabilities2.insert(line[..eq].to_string(), Some(line[eq + 1..].to_string()));
                } else {
                    capabilities2.insert(line, None);
                }
            }
        }
    }
    RefsAdResponse::V2 {
        protocol_version: 2,
        capabilities2,
    }
}

pub fn write_refs_ad_response(
    capabilities: &[&str],
    refs: &BTreeMap<String, String>,
    symrefs: &BTreeMap<String, String>,
) -> Vec<u8> {
    let mut out = Vec::new();
    let mut syms = String::new();
    for (k, v) in symrefs {
        syms.push_str(&format!("symref={k}:{v} "));
    }
    let mut caps = format!("\0{} {syms}agent=git/isomorphic-git@0.0.0-development", capabilities.join(" "));
    for (k, v) in refs {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("{v} {k}{caps}\n")));
        caps.clear();
    }
    out.extend_from_slice(&GitPktLine::flush());
    out
}

pub fn write_list_refs_request(
    prefix: Option<&str>,
    symrefs: bool,
    peel_tags: bool,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&GitPktLine::encode_str("command=ls-refs\n"));
    out.extend_from_slice(&GitPktLine::encode_str(
        "agent=git/isomorphic-git@0.0.0-development\n",
    ));
    if peel_tags || symrefs || prefix.is_some() {
        out.extend_from_slice(&GitPktLine::delim());
    }
    if peel_tags {
        out.extend_from_slice(&GitPktLine::encode_str("peel"));
    }
    if symrefs {
        out.extend_from_slice(&GitPktLine::encode_str("symrefs"));
    }
    if let Some(p) = prefix {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("ref-prefix {p}")));
    }
    out.extend_from_slice(&GitPktLine::flush());
    out
}

pub fn parse_list_refs_response(stream: &[u8]) -> Vec<ServerRef> {
    let mut reader = GitPktLine::stream_reader(stream);
    let mut refs = Vec::new();
    loop {
        match reader.read() {
            PktLineItem::Eof => break,
            PktLineItem::Flush | PktLineItem::Delim => continue,
            PktLineItem::Line(bytes) => {
                let line = String::from_utf8_lossy(&bytes)
                    .trim_end_matches('\n')
                    .to_string();
                let mut parts = line.split(' ');
                let Some(oid) = parts.next() else { continue };
                let Some(r#ref) = parts.next() else { continue };
                let mut target = None;
                let mut peeled = None;
                for attr in parts {
                    if let Some((name, val)) = attr.split_once(':') {
                        if name == "symref-target" {
                            target = Some(val.to_string());
                        } else if name == "peeled" {
                            peeled = Some(val.to_string());
                        }
                    }
                }
                refs.push(ServerRef {
                    r#ref: r#ref.to_string(),
                    oid: oid.to_string(),
                    target,
                    peeled,
                });
            }
        }
    }
    refs
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UploadPackRequest {
    pub capabilities: Vec<String>,
    pub wants: Vec<String>,
    pub haves: Vec<String>,
    pub shallows: Vec<String>,
    pub depth: Option<usize>,
    pub since: Option<i64>,
    pub exclude: Vec<String>,
    pub relative: bool,
    pub done: bool,
}

pub fn write_upload_pack_request(req: &UploadPackRequest) -> Vec<u8> {
    let mut out = Vec::new();
    let mut seen_wants = BTreeSet::new();
    let mut unique_wants = Vec::new();
    for w in &req.wants {
        if seen_wants.insert(w.clone()) {
            unique_wants.push(w.clone());
        }
    }
    let mut first_caps = if req.capabilities.is_empty() {
        String::new()
    } else {
        format!(" {}", req.capabilities.join(" "))
    };
    for oid in unique_wants {
        out.extend_from_slice(&GitPktLine::encode_str(&format!(
            "want {oid}{first_caps}\n"
        )));
        first_caps.clear();
    }
    for oid in &req.shallows {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("shallow {oid}\n")));
    }
    if let Some(depth) = req.depth {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("deepen {depth}\n")));
    }
    if let Some(since) = req.since {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("deepen-since {since}\n")));
    }
    for oid in &req.exclude {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("deepen-not {oid}\n")));
    }
    out.extend_from_slice(&GitPktLine::flush());
    for oid in &req.haves {
        out.extend_from_slice(&GitPktLine::encode_str(&format!("have {oid}\n")));
    }
    out.extend_from_slice(&GitPktLine::encode_str("done\n"));
    out
}

pub fn parse_upload_pack_request(stream: &[u8]) -> UploadPackRequest {
    let mut reader = GitPktLine::stream_reader(stream);
    let mut req = UploadPackRequest::default();
    let mut caps_initialized = false;
    while !req.done {
        match reader.read() {
            PktLineItem::Eof => break,
            PktLineItem::Flush | PktLineItem::Delim => continue,
            PktLineItem::Line(bytes) => {
                let s = String::from_utf8_lossy(&bytes);
                let parts: Vec<&str> = s.trim().split(' ').collect();
                if parts.is_empty() {
                    continue;
                }
                let key = parts[0];
                let val = parts.get(1).copied().unwrap_or("");
                if !caps_initialized {
                    caps_initialized = true;
                    if parts.len() > 2 {
                        req.capabilities = parts[2..].iter().map(|s| s.to_string()).collect();
                    }
                }
                match key {
                    "want" => req.wants.push(val.to_string()),
                    "have" => req.haves.push(val.to_string()),
                    "shallow" => req.shallows.push(val.to_string()),
                    "deepen" => req.depth = val.parse().ok(),
                    "deepen-since" => req.since = val.parse().ok(),
                    "deepen-not" => req.exclude.push(val.to_string()),
                    "deepen-relative" => req.relative = true,
                    "done" => req.done = true,
                    _ => {}
                }
            }
        }
    }
    req
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AckEntry {
    pub oid: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadPackResponse {
    pub shallows: Vec<String>,
    pub unshallows: Vec<String>,
    pub acks: Vec<AckEntry>,
    pub nak: bool,
    pub packfile: Vec<u8>,
    pub progress: Vec<Vec<u8>>,
}

pub fn parse_upload_pack_response(stream: &[u8]) -> Result<UploadPackResponse, GitError> {
    let demuxed = GitSideBand::demux(stream);
    if let Some(err) = demuxed.error {
        return Err(GitError::internal(&err));
    }
    let mut shallows = Vec::new();
    let mut unshallows = Vec::new();
    let mut acks = Vec::new();
    let mut nak = false;

    for data in &demuxed.packetlines {
        if data.is_empty() {
            continue;
        }
        let line = String::from_utf8_lossy(data).trim().to_string();
        if let Some(rest) = line.strip_prefix("shallow") {
            let oid = rest.trim().to_string();
            if oid.len() != 40 {
                return Err(GitError::invalid_oid(&oid));
            }
            shallows.push(oid);
        } else if let Some(rest) = line.strip_prefix("unshallow") {
            let oid = rest.trim().to_string();
            if oid.len() != 40 {
                return Err(GitError::invalid_oid(&oid));
            }
            unshallows.push(oid);
        } else if line.starts_with("ACK ") {
            let parts: Vec<&str> = line.split(' ').collect();
            let oid = parts.get(1).copied().unwrap_or("").to_string();
            let status = parts.get(2).map(|s| s.to_string());
            acks.push(AckEntry { oid, status });
        } else if line.starts_with("NAK") {
            nak = true;
        } else {
            nak = true;
        }
    }

    Ok(UploadPackResponse {
        shallows,
        unshallows,
        acks,
        nak,
        packfile: demuxed.packfile,
        progress: demuxed.progress,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivePackTriplet {
    pub oldoid: String,
    pub oid: String,
    pub full_ref: String,
}

pub fn write_receive_pack_request(
    capabilities: &[&str],
    triplets: &[ReceivePackTriplet],
) -> Vec<u8> {
    let mut out = Vec::new();
    let mut caps_first = format!("\0 {}", capabilities.join(" "));
    for trip in triplets {
        out.extend_from_slice(&GitPktLine::encode_str(&format!(
            "{} {} {}{caps_first}\n",
            trip.oldoid, trip.oid, trip.full_ref
        )));
        caps_first.clear();
    }
    out.extend_from_slice(&GitPktLine::flush());
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefUpdateStatus {
    pub ok: bool,
    pub error: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushResult {
    pub ok: bool,
    pub error: Option<String>,
    pub refs: BTreeMap<String, RefUpdateStatus>,
}

pub fn parse_receive_pack_response(packfile: &[u8]) -> Result<PushResult, GitError> {
    let mut reader = GitPktLine::stream_reader(packfile);
    let mut lines = Vec::new();
    loop {
        match reader.read() {
            PktLineItem::Eof => break,
            PktLineItem::Flush | PktLineItem::Delim => continue,
            PktLineItem::Line(bytes) => {
                let s = String::from_utf8_lossy(&bytes)
                    .trim_end_matches('\n')
                    .to_string();
                lines.push(s);
            }
        }
    }
    let first = lines.first().cloned().unwrap_or_default();
    if !first.starts_with("unpack ") {
        return Err(GitError::parse(
            "unpack ok\" or \"unpack [error message]",
            &first,
        ));
    }
    let ok = first == "unpack ok";
    let error = if ok {
        None
    } else {
        Some(first["unpack ".len()..].to_string())
    };
    let mut refs = BTreeMap::new();
    for line in lines.into_iter().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let status = &line[..2.min(line.len())];
        let rest = if line.len() > 3 { &line[3..] } else { "" };
        let (r#ref, err_msg) = match rest.find(' ') {
            Some(sp) => (&rest[..sp], &rest[sp + 1..]),
            None => (rest, ""),
        };
        refs.insert(
            r#ref.to_string(),
            RefUpdateStatus {
                ok: status == "ok",
                error: err_msg.to_string(),
            },
        );
    }
    Ok(PushResult { ok, error, refs })
}
