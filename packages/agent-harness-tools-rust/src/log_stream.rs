//! Managed log admission, byte framing and portable shell quoting.
pub fn safe_job_id(id: &[u16]) -> bool {
    !id.is_empty()
        && id != [46]
        && id != [46, 46]
        && !id.iter().any(|unit| matches!(*unit, 0 | 47 | 92))
}
pub fn complete_utf8_prefix(bytes: &[u8]) -> usize {
    let Some(lead) = bytes.iter().rposition(|byte| !matches!(*byte, 0x80..=0xbf)) else {
        return bytes.len();
    };
    let expected = match bytes[lead] {
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => 0,
    };
    if expected > 0 && bytes.len() - lead < expected {
        lead
    } else {
        bytes.len()
    }
}
pub fn decimal_exit_code(value: &[u16]) -> Option<f64> {
    if value == [48] {
        return Some(0.0);
    }
    if !matches!(value.first(), Some(49..=57)) || !value.iter().all(|unit| matches!(*unit, 48..=57))
    {
        return None;
    }
    value
        .iter()
        .map(|unit| (*unit as u8) as char)
        .collect::<String>()
        .parse()
        .ok()
}
fn quote(value: &[u16]) -> Vec<u16> {
    let mut out = vec![39];
    for unit in value {
        if *unit == 39 {
            out.extend([39, 92, 39, 39]);
        } else {
            out.push(*unit);
        }
    }
    out.push(39);
    out
}
pub fn tee_command(argv: &[Vec<u16>], job: &[u16]) -> Result<Vec<Vec<u16>>, &'static str> {
    if !safe_job_id(job) {
        return Err("Invalid job id");
    }
    if argv.is_empty() {
        return Err("wrapForLogTee requires argv to contain at least one argument");
    }
    let mut log: Vec<u16> = "/tmp/poe-jobs/".encode_utf16().collect();
    log.extend(job);
    let mut exit = log.clone();
    exit.extend(".exit".encode_utf16());
    log.extend(".log".encode_utf16());
    let mut tmp = exit.clone();
    tmp.extend(".tmp".encode_utf16());
    let log = quote(&log);
    let exit = quote(&exit);
    let tmp = quote(&tmp);
    let mut script: Vec<u16> = "mkdir -p '/tmp/poe-jobs' && test ! -L '/tmp/poe-jobs'"
        .encode_utf16()
        .collect();
    for target in [&log, &exit, &tmp] {
        script.extend(" && test ! -L ".encode_utf16());
        script.extend(target);
    }
    script.extend(" && ({ (".encode_utf16());
    for (index, arg) in argv.iter().enumerate() {
        if index > 0 {
            script.push(32);
        }
        script.extend(quote(arg));
    }
    script.extend("); echo $? > ".encode_utf16());
    script.extend(&tmp);
    script.extend("; } 2>&1 | tee ".encode_utf16());
    script.extend(log);
    script.extend("; mv ".encode_utf16());
    script.extend(tmp);
    script.push(32);
    script.extend(exit);
    script.extend(")".encode_utf16());
    Ok(vec![
        "sh".encode_utf16().collect(),
        "-c".encode_utf16().collect(),
        script,
    ])
}
