#[path = "csvkit_codepages.rs"]
mod codepages;

enum Encoding {
    Utf8,
    Utf8Sig,
    Utf16,
    Utf16Le,
    Utf16Be,
    Ascii,
    Latin1,
    Page(&'static [u16; 128]),
    Unsupported,
}

pub(super) fn decode(mut bytes: Vec<u8>, name: &str, max_memory: usize) -> Result<String, String> {
    let mut normalized = String::new();
    let mut separator = false;
    for b in name.bytes() {
        if b.is_ascii_alphanumeric() || b == b'.' {
            if separator && !normalized.is_empty() {
                normalized.push('_');
            }
            normalized.push(char::from(b.to_ascii_lowercase()));
            separator = false;
        } else {
            separator = true;
        }
    }
    let encoding = codepages::lookup(&normalized)
        .ok_or_else(|| format!("LookupError: unknown encoding: {name}"))?;
    let bad = || {
        format!(
            "Your file is not \"{name}\" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error."
        )
    };
    let limit = if max_memory == 0 {
        usize::MAX
    } else {
        max_memory
    };
    let bound = "Memory budget exceeded while decoding CSV input";
    if bytes.len() > limit {
        return Err(bound.into());
    }
    if matches!(
        encoding,
        Encoding::Utf8 | Encoding::Utf8Sig | Encoding::Ascii
    ) {
        if matches!(encoding, Encoding::Ascii) && !bytes.is_ascii() {
            return Err(bad());
        }
        if matches!(encoding, Encoding::Utf8Sig) {
            let signature = [0xef, 0xbb, 0xbf];
            if bytes.starts_with(&signature) {
                bytes.drain(..3);
            } else if signature.starts_with(&bytes) {
                bytes.clear();
            }
        }
        return String::from_utf8(bytes).map_err(|_| bad());
    }
    let available = limit - bytes.len();
    let mut out = String::new();
    let mut push = |c: char| {
        if out.len().saturating_add(c.len_utf8()) > available {
            return Err(bound.to_owned());
        }
        out.push(c);
        Ok(())
    };
    match encoding {
        Encoding::Unsupported => {
            return Err(format!("csvkit: unsupported or unqualified: codec {name}"));
        }
        Encoding::Latin1 | Encoding::Page(_) => {
            for b in bytes {
                let c = match encoding {
                    Encoding::Page(page) if b >= 128 => {
                        let cp = page[usize::from(b) - 128];
                        if cp == 0xffff {
                            return Err(bad());
                        }
                        char::from_u32(cp.into()).ok_or_else(bad)?
                    }
                    _ => char::from(b),
                };
                push(c)?;
            }
        }
        Encoding::Utf16 | Encoding::Utf16Le | Encoding::Utf16Be => {
            let (start, big) = match encoding {
                Encoding::Utf16 if bytes.starts_with(&[0xfe, 0xff]) => (2, true),
                Encoding::Utf16 if bytes.starts_with(&[0xff, 0xfe]) => (2, false),
                Encoding::Utf16 if !bytes.is_empty() => return Err(bad()),
                _ => (0, matches!(encoding, Encoding::Utf16Be)),
            };
            let pairs = bytes[start..].chunks_exact(2);
            if !pairs.remainder().is_empty() {
                return Err(bad());
            }
            let units = pairs.map(|p| {
                if big {
                    u16::from_be_bytes([p[0], p[1]])
                } else {
                    u16::from_le_bytes([p[0], p[1]])
                }
            });
            for c in char::decode_utf16(units) {
                push(c.map_err(|_| bad())?)?;
            }
        }
        _ => unreachable!(),
    }
    Ok(out)
}
