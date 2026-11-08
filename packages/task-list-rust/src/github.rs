//! GitHub task identities and declarative state resolution.
pub fn issue_number(id: &[u16]) -> Option<u64> {
    if id.is_empty() || id[0] == 48 {
        return None;
    }
    let mut number = 0u64;
    for unit in id {
        if !matches!(*unit, 48..=57) {
            return None;
        }
        number = number.checked_mul(10)?.checked_add(u64::from(*unit - 48))?;
        if number > 9_007_199_254_740_991 {
            return None;
        }
    }
    (number > 0).then_some(number)
}
pub fn parse_repo(repo: &[u16]) -> Option<(Vec<u16>, Vec<u16>)> {
    let mut parts = repo.split(|u| *u == 47);
    let owner = parts.next()?;
    let name = parts.next()?;
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some((owner.to_vec(), name.to_vec()))
}
pub fn resolve_state(
    labels: &[Vec<u16>],
    status: Option<&[u16]>,
    states: &[Vec<u16>],
    initial: &[u16],
    prefix: Option<&[u16]>,
) -> Vec<u16> {
    let Some(prefix) = prefix else {
        return status.unwrap_or(initial).to_vec();
    };
    for state in states {
        let label: Vec<_> = prefix.iter().chain(state.iter()).copied().collect();
        if labels.contains(&label) {
            return state.clone();
        }
    }
    initial.to_vec()
}
