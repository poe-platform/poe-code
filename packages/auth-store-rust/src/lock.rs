//! Filesystem lock policy, independent of host I/O and process liveness.
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

pub fn next_ticket(tickets: &[f64]) -> Result<f64, &'static str> {
    let maximum = tickets.iter().fold(0.0_f64, |maximum, ticket| {
        if maximum.is_nan() || ticket.is_nan() {
            f64::NAN
        } else {
            maximum.max(*ticket)
        }
    });
    let ticket = maximum + 1.0;
    if is_safe_integer(ticket) {
        Ok(ticket)
    } else {
        Err("Secret-store transaction lock ticket overflow")
    }
}

pub fn is_safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
}

pub fn precedes(peer: Option<f64>, ticket: f64, peer_name: &[u16], name: &[u16]) -> bool {
    peer.is_none_or(|peer| peer < ticket || (peer == ticket && peer_name < name))
}

#[derive(Debug, PartialEq, Eq)]
pub enum CleanupTarget {
    Temporary,
    Claim,
}

pub struct LockLifecycle {
    deadline: f64,
    claim_owned: bool,
    temporary_owned: bool,
}

impl LockLifecycle {
    pub fn new(deadline: f64) -> Self {
        Self {
            deadline,
            claim_owned: true,
            temporary_owned: false,
        }
    }

    pub fn claim_failed(&mut self, collision: bool) {
        if collision {
            self.claim_owned = false;
        }
    }

    pub fn begin_publication(&mut self) {
        self.temporary_owned = true;
    }

    pub fn publication_failed(&mut self, collision: bool) {
        if collision {
            self.temporary_owned = false;
        }
    }

    pub fn published(&mut self) {
        self.temporary_owned = false;
    }

    pub fn cleanup_targets(&self) -> Vec<CleanupTarget> {
        let mut targets = Vec::with_capacity(2);
        if self.temporary_owned {
            targets.push(CleanupTarget::Temporary);
        }
        if self.claim_owned {
            targets.push(CleanupTarget::Claim);
        }
        targets
    }

    pub fn wait_delay(&self, now: f64) -> Result<f64, &'static str> {
        let remaining = self.deadline - now;
        if remaining <= 0.0 {
            return Err("Timed out waiting for secret-store transaction lock");
        }
        Ok(if remaining.is_nan() {
            f64::NAN
        } else {
            remaining.min(10.0)
        })
    }
}
