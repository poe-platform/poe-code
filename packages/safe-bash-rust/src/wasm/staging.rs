use super::*;
use crate::vfs::memory::{StageAction, StageContent, StageDestination};

#[unsafe(no_mangle)]
pub unsafe extern "C" fn safe_bash_owned_stage(
    id: u32,
    paths_ptr: *const u8,
    paths_len: usize,
    stats_ptr: *const u8,
    stats_len: usize,
    data_ptr: *const u8,
    data_len: usize,
    op: u32,
    flags: u32,
    mode: f64,
    atime: f64,
    mtime: f64,
) -> i32 {
    let paths: Vec<_> = unsafe { str_from_raw(paths_ptr, paths_len) }
        .split('\0')
        .collect();
    let bytes = unsafe { slice_from_raw(stats_ptr, stats_len) };
    let Ok(mut map) = sessions().lock() else {
        return -1;
    };
    let Some(sess) = map.get_mut(&id) else {
        return -1;
    };
    let result: Result<Vec<u8>, String> = (|| {
        let fs = sess
            .shell
            .fs
            .memory_backend()
            .ok_or("ENOTSUP: unsupported filesystem")?;
        let invalid = "EINVAL: invalid staging request";
        if !bytes.len().is_multiple_of(72) {
            return Err(invalid.into());
        }
        let stats = bytes
            .chunks_exact(72)
            .map(memory_receipt)
            .collect::<Result<Vec<_>, _>>()?;
        if op == 0 {
            let ([dir, name], [parent]) = (&paths[..], &stats[..]) else {
                return Err(invalid.into());
            };
            if mode.fract() != 0. || !(0.0..=4095.0).contains(&mode) {
                return Err(invalid.into());
            }
            let data = unsafe { slice_from_raw(data_ptr, data_len) };
            let content = if flags & 1 == 0 {
                StageContent::File(data)
            } else {
                StageContent::Symlink(std::str::from_utf8(data).map_err(|_| invalid)?)
            };
            let pin = flags & 8 != 0 && matches!(content, StageContent::File(_));
            if pin && sess.retained_stages.len() >= fs.max_entries() {
                return Err("ENOSPC: staging handle limit exceeded".into());
            }
            let receipt = fs.create_owned_stage(
                dir,
                name,
                content,
                parent,
                mode as u32,
                [
                    (flags & 2 != 0).then_some(atime),
                    (flags & 4 != 0).then_some(mtime),
                ],
            )?;
            if pin {
                let (path, stat) = &receipt[2];
                let Some(crate::vfs::EntryIdentity::Memory(_, ino)) = stat.identity else {
                    unreachable!()
                };
                // No other Wasm call can change the session namespace before this pin.
                sess.retained_stages.insert(ino, fs.retain_file(path)?);
            }
            let mut out = Vec::new();
            for (path, stat) in receipt {
                for field in [path.into_bytes(), stat_bytes(stat)] {
                    out.extend_from_slice(&(field.len() as u32).to_le_bytes());
                    out.extend(field);
                }
            }
            return Ok(out);
        }
        if stats.len() < 3 || paths.len() < 3 {
            return Err(invalid.into());
        }
        let entries = [
            (paths[0], &stats[0]),
            (paths[1], &stats[1]),
            (paths[2], &stats[2]),
        ];
        match op {
            1 => {
                let offset = 4 + usize::from(flags & 1 != 0);
                if paths.len() < 4
                    || stats.len() < offset
                    || paths.len() - 4 != stats.len() - offset
                {
                    return Err(invalid.into());
                }
                let ancestors = paths[4..]
                    .iter()
                    .copied()
                    .zip(stats[offset..].iter().cloned())
                    .collect::<Vec<_>>();
                fs.finish_owned_stage(
                    entries,
                    StageAction::Publish(StageDestination {
                        path: paths[3],
                        parent: &stats[3],
                        expected: (flags & 1 != 0).then(|| &stats[4]),
                        ancestors: (flags & 2 != 0).then_some(&ancestors),
                    }),
                )?;
            }
            2..=5 if paths.len() == 3 && stats.len() == 3 => {
                let action = match op {
                    2 | 5 => StageAction::Remove { retained: op == 5 },
                    3 => StageAction::Append(unsafe { slice_from_raw(data_ptr, data_len) }),
                    _ if atime.is_finite() && mtime.is_finite() => {
                        StageAction::Finish { atime, mtime }
                    }
                    _ => return Err(invalid.into()),
                };
                if let Some(stat) = fs.finish_owned_stage(entries, action)? {
                    return Ok(stat_bytes(stat));
                }
            }
            _ => return Err(invalid.into()),
        }
        Ok(Vec::new())
    })();
    match result {
        Ok(out) => {
            sess.last_output_buf = out;
            sess.last_output_buf.len() as i32
        }
        Err(e) => sess.read_error(&e, "fileStaging", paths[0], None, None),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn safe_bash_close_stage(id: u32, ino: u64) {
    if let Ok(mut map) = sessions().lock()
        && let Some(sess) = map.get_mut(&id)
    {
        sess.retained_stages.remove(&ino);
    }
}
