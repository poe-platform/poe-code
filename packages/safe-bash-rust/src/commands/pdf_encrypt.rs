// Encrypt the rewritten object graph, including objects introduced by page and attachment edits.
use super::{
    Value,
    pdf_rewrite::{encode, finish_classic},
    pdf_security::{pdf_aes, transform_strings},
    strict_index,
};
use std::io::Write;

pub(in super::super) fn encrypt_document(
    bytes: &[u8],
    user: &str,
    owner: &str,
    permissions: i32,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let invalid = "invalid PDF object graph";
    let large = "PDF output byte limit exceeded";
    let (mut objects, trailer) = strict_index(bytes).ok_or(invalid)?;
    objects.preserve_hex = true;
    let encrypt_id = objects
        .xref
        .keys()
        .next_back()
        .ok_or(invalid)?
        .0
        .checked_add(1)
        .ok_or(large)?;
    let count = encrypt_id
        .checked_add(1)
        .filter(|&n| n <= limit / 20)
        .ok_or(large)?;
    let (key, security) = pdf_aes::encryption(user, owner, permissions)?;
    let mut rows = vec![(0, 0, 65535); count];
    let mut out = b"%PDF-2.0\n%\xc2\x81\xc2\x81\xc2\x81\xc2\x81\n\n".to_vec();
    for id in objects.xref.keys().copied().collect::<Vec<_>>() {
        rows[id.0] = (1, out.len(), id.1);
        writeln!(out, "{} {} obj", id.0, id.1).unwrap();
        let (mut value, mut cursor) = objects.object(id).ok_or(invalid)?;
        cursor.skip();
        let stream = if cursor.0.starts_with(b"stream") {
            Some(objects.stream(&value, cursor).ok_or(invalid)?)
        } else {
            None
        };
        let xref = stream.is_some() && value.get(b"Type").and_then(Value::word) == Some(b"/XRef");
        let mut remaining = limit.saturating_sub(out.len());
        if !xref {
            transform_strings(&mut value, &mut |data| -> Result<(), String> {
                *data = pdf_aes::encrypt(&key, data, remaining / 2)?;
                remaining -= 2 * data.len();
                Ok(())
            })?;
        }
        let encrypted;
        let payload = match stream {
            Some(s) if !xref => {
                encrypted = pdf_aes::encrypt(&key, s, remaining)?;
                Some(encrypted.as_slice())
            }
            other => other,
        };
        if let Some(data) = payload {
            value.set_stream_length(data.len()).ok_or(invalid)?;
        }
        encode(&value, &mut out)?;
        if let Some(data) = payload {
            if data.len() > limit.saturating_sub(out.len()) {
                return Err(large.into());
            }
            out.extend_from_slice(b"\nstream\n");
            out.extend_from_slice(data);
            out.extend_from_slice(b"\nendstream");
        }
        out.extend_from_slice(b"\nendobj\n\n");
        if out.len() > limit {
            return Err(large.into());
        }
    }
    rows[encrypt_id] = (1, out.len(), 0);
    writeln!(out, "{encrypt_id} 0 obj").unwrap();
    encode(&security, &mut out)?;
    out.extend_from_slice(b"\nendobj\n\n");
    let mut entries = b"/Root ".to_vec();
    encode(trailer.get(b"Root").ok_or(invalid)?, &mut entries)?;
    if let Some(info) = trailer.get(b"Info") {
        entries.extend_from_slice(b"\n/Info ");
        encode(info, &mut entries)?;
    }
    write!(entries, "\n/Encrypt {encrypt_id} 0 R\n/ID ").unwrap();
    let mut id = vec![0; 16];
    crate::vfs::memory::fill_random(&mut id)?;
    let id = Value::String {
        bytes: id,
        hex: true,
    };
    encode(&Value::Array(vec![id.clone(), id]), &mut entries)?;
    entries.push(b'\n');
    finish_classic(
        out,
        rows,
        &entries,
        trailer
            .get(b"Root")
            .and_then(Value::reference)
            .ok_or(invalid)?
            .0,
        limit,
    )
}
