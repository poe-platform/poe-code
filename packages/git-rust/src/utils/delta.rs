use crate::errors::GitError;

pub fn apply_delta(delta: &[u8], source: &[u8]) -> Result<Vec<u8>, GitError> {
    let mut pos = 0usize;
    let source_size = read_varint_le(delta, &mut pos)?;
    if source_size != source.len() {
        return Err(GitError::internal(&format!(
            "applyDelta expected source buffer to be {source_size} bytes but the provided buffer was {} bytes",
            source.len()
        )));
    }
    let target_size = read_varint_le(delta, &mut pos)?;

    if target_size > 64 * 1024 * 1024 {
        return Err(GitError::internal("Delta result exceeds object byte limit"));
    }
    let mut out = Vec::with_capacity(target_size);
    while pos < delta.len() {
        let op = read_op(delta, &mut pos, source)?;
        if op.len() > target_size.saturating_sub(out.len()) {
            return Err(GitError::internal(
                "Delta exceeds its declared target length",
            ));
        }
        out.extend_from_slice(op);
    }
    if out.len() != target_size {
        return Err(GitError::internal(
            "Delta does not match its declared target length",
        ));
    }
    Ok(out)
}

fn read_varint_le(data: &[u8], pos: &mut usize) -> Result<usize, GitError> {
    let mut result = 0usize;
    let mut shift = 0usize;
    loop {
        if *pos >= data.len() {
            return Err(GitError::internal("Unexpected EOF reading delta varint"));
        }
        let byte = data[*pos];
        *pos += 1;
        if shift >= usize::BITS as usize || (byte & 0x7f) as usize > usize::MAX >> shift {
            return Err(GitError::internal("Delta varint overflow"));
        }
        result |= ((byte & 0x7f) as usize) << shift;
        if (byte & 0x80) == 0 {
            break;
        }
        shift += 7;
    }
    Ok(result)
}

fn read_compact_le(
    data: &[u8],
    pos: &mut usize,
    mut flags: u8,
    size: usize,
) -> Result<usize, GitError> {
    let mut result = 0usize;
    let mut shift = 0usize;
    for _ in 0..size {
        if (flags & 1) != 0 {
            if *pos >= data.len() {
                return Err(GitError::internal(
                    "Unexpected EOF reading delta compact integer",
                ));
            }
            result |= (data[*pos] as usize) << shift;
            *pos += 1;
        }
        flags >>= 1;
        shift += 8;
    }
    Ok(result)
}

fn read_op<'a>(data: &'a [u8], pos: &mut usize, source: &'a [u8]) -> Result<&'a [u8], GitError> {
    if *pos >= data.len() {
        return Err(GitError::internal("Unexpected EOF reading delta op"));
    }
    let byte = data[*pos];
    *pos += 1;
    if (byte & 0x80) != 0 {
        let offset = read_compact_le(data, pos, byte & 0x0f, 4)?;
        let mut size = read_compact_le(data, pos, (byte & 0x70) >> 4, 3)?;
        if size == 0 {
            size = 0x10000;
        }
        let end = offset
            .checked_add(size)
            .ok_or_else(|| GitError::internal("Delta copy range overflow"))?;
        if end > source.len() {
            return Err(GitError::internal("Delta copy range out of bounds"));
        }
        Ok(&source[offset..end])
    } else if byte > 0 {
        let len = byte as usize;
        if *pos + len > data.len() {
            return Err(GitError::internal("Delta insert length out of bounds"));
        }
        let slice = &data[*pos..*pos + len];
        *pos += len;
        Ok(slice)
    } else {
        Err(GitError::internal("Invalid delta opcode 0"))
    }
}
