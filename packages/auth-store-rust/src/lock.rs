//! Filesystem lock admission, independent of host I/O and process liveness.
pub fn validate_timeout(timeout: f64) -> Result<(), &'static str> {
    if timeout == f64::INFINITY
        || (timeout.is_finite() && (0.0..=2_147_483_647.0).contains(&timeout))
    {
        Ok(())
    } else {
        Err("Invalid secret-store transaction lock timeout")
    }
}

pub fn owner(name: &[u16], own_name: &[u16]) -> Result<Option<f64>, &'static str> {
    if name == own_name || !name.ends_with(&[46, 99, 108, 97, 105, 109]) {
        return Ok(None);
    }
    let invalid = "Malformed secret-store transaction lock owner";
    let end = name.iter().position(|unit| *unit == 45).ok_or(invalid)?;
    let digits = &name[..end];
    if !digits.first().is_some_and(|unit| (49..=57).contains(unit)) {
        return Err(invalid);
    }
    let mut pid = 0_u64;
    for unit in digits {
        if !(48..=57).contains(unit) {
            return Err(invalid);
        }
        pid = pid * 10 + u64::from(*unit - 48);
        if pid > 9_007_199_254_740_991 {
            return Err(invalid);
        }
    }
    Ok(Some(pid as f64))
}

pub fn protected_paths(resolved: &[u16], root_len: usize, separator: u16) -> Vec<Vec<u16>> {
    if resolved.len() == root_len {
        return vec![];
    }
    crate::protected_paths(resolved, root_len, separator, None, true)
}
