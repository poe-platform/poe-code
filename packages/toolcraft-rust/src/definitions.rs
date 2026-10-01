use std::collections::HashMap;

/// Metadata values remain in the host heap; presence selects their source.
/// Own auth/version presence means non-nullish; parent presence means defined.
#[derive(Default)]
pub struct Metadata {
    pub scope: Option<Vec<Vec<u16>>>,
    pub secrets: Vec<Vec<u16>>,
    pub approval: bool,
    pub auth: bool,
    pub version: bool,
    pub check: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Absent,
    Parent,
    Own,
    Both,
}

pub struct MetadataPlan {
    pub scope: Option<Vec<Vec<u16>>>,
    pub secrets: Vec<(Source, usize)>,
    pub approval: Source,
    pub auth: Source,
    pub version: Source,
    pub check: Source,
}

pub fn merge_metadata(parent: &Metadata, own: &Metadata, command: bool) -> MetadataPlan {
    let select = |parent, own| {
        if own {
            Source::Own
        } else if parent {
            Source::Parent
        } else {
            Source::Absent
        }
    };
    let mut indices: HashMap<&[u16], usize> = HashMap::new();
    let mut secrets = Vec::new();
    for (source, names) in [
        (Source::Parent, &parent.secrets),
        (Source::Own, &own.secrets),
    ] {
        for (index, name) in names.iter().enumerate() {
            if let Some(position) = indices.get(name.as_slice()) {
                secrets[*position] = (source, index);
            } else {
                indices.insert(name, secrets.len());
                secrets.push((source, index));
            }
        }
    }
    MetadataPlan {
        scope: own
            .scope
            .clone()
            .or_else(|| parent.scope.clone())
            .or_else(|| {
                command.then(|| {
                    vec![
                        "cli".encode_utf16().collect(),
                        "sdk".encode_utf16().collect(),
                    ]
                })
            }),
        secrets,
        approval: select(parent.approval, own.approval),
        auth: select(parent.auth, own.auth),
        version: select(parent.version, own.version),
        check: if parent.check && own.check {
            Source::Both
        } else {
            select(parent.check, own.check)
        },
    }
}

pub fn rename_issue(targets: &[Vec<u16>]) -> Option<(&'static str, usize, usize)> {
    let mut seen = HashMap::new();
    for (index, target) in targets.iter().enumerate() {
        if target.is_empty() {
            return Some(("empty", index, 0));
        }
        if target
            .split(|unit| *unit == u16::from(b'.'))
            .any(|part| part.is_empty())
        {
            return Some(("segment", index, 0));
        }
        if let Some(previous) = seen.insert(target, index) {
            return Some(("duplicate", index, previous));
        }
    }
    None
}

pub fn default_child_issue(index: i32, commands: &[bool]) -> Option<&'static str> {
    match usize::try_from(index)
        .ok()
        .and_then(|index| commands.get(index))
    {
        None => Some("missing"),
        Some(false) => Some("group"),
        Some(true) => None,
    }
}

pub fn source_location(line: &[u16]) -> Option<Vec<u16>> {
    let whitespace =
        |unit: u16| char::from_u32(u32::from(unit)).is_some_and(super::ecmascript_whitespace);
    let start = line.iter().position(|unit| !whitespace(*unit))?;
    let end = line.iter().rposition(|unit| !whitespace(*unit))? + 1;
    let line = &line[start..end];
    let file: Vec<u16> = "file://".encode_utf16().collect();
    let offset = line
        .windows(file.len())
        .position(|part| part == file)
        .or_else(|| line.iter().position(|unit| *unit == u16::from(b'/')))?;
    let location = &line[offset..];
    let end = location
        .iter()
        .rposition(|unit| *unit == u16::from(b':'))
        .and_then(|last| {
            location[..last]
                .iter()
                .rposition(|unit| *unit == u16::from(b':'))
        })
        .unwrap_or(location.len());
    Some(location[..end].to_vec())
}
