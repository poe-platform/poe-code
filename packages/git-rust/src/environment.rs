//! Request-local environment, independent of the host process (including on WASM).
use std::{cell::RefCell, collections::BTreeMap};
thread_local! {
    static ENV: RefCell<BTreeMap<String, String>> = const { RefCell::new(BTreeMap::new()) };
}
pub(crate) struct EnvironmentScope(BTreeMap<String, String>);
impl EnvironmentScope {
    pub(crate) fn new(env: BTreeMap<String, String>) -> Self {
        Self(ENV.with(|current| current.replace(env)))
    }
}
impl Drop for EnvironmentScope {
    fn drop(&mut self) {
        ENV.with(|current| {
            current.replace(std::mem::take(&mut self.0));
        });
    }
}
pub(crate) fn get(name: &str) -> Option<String> {
    ENV.with(|env| env.borrow().get(name).cloned())
}
pub(crate) fn home() -> String {
    get("HOME").unwrap_or_else(|| "/home/user".to_string())
}
pub(crate) fn identity(
    mut author: crate::utils::Author,
    role: &str,
) -> Result<crate::utils::Author, crate::GitError> {
    if let Some(name) = get(&format!("GIT_{role}_NAME")) {
        author.name = name;
    }
    if let Some(email) = get(&format!("GIT_{role}_EMAIL")) {
        author.email = email;
    }
    if let Some(date) = get(&format!("GIT_{role}_DATE")) {
        let (timestamp, offset) = parse_date(&date)
            .ok_or_else(|| crate::GitError::internal("invalid Git environment date"))?;
        author.timestamp = timestamp;
        author.timezone_offset = offset;
    }
    Ok(author)
}

fn parse_date(date: &str) -> Option<(i64, f64)> {
    fn zone(value: &str) -> Option<f64> {
        let value = value.replace(':', "");
        let bytes = value.as_bytes();
        if bytes.len() != 5
            || !matches!(bytes[0], b'+' | b'-')
            || !bytes[1..].iter().all(u8::is_ascii_digit)
        {
            return None;
        }
        if value[1..3].parse::<u32>().ok()? > 23 || value[3..].parse::<u32>().ok()? > 59 {
            return None;
        }
        Some(crate::utils::parse_timezone_offset(&value))
    }
    let parts: Vec<_> = date.split_whitespace().collect();
    if let [timestamp, offset] = parts.as_slice()
        && let Ok(timestamp) = timestamp.trim_start_matches('@').parse::<i64>()
    {
        return Some((timestamp, zone(offset)?));
    }
    // ISO 8601 with an explicit offset or Z; never consult the host timezone.
    let (civil, offset) = if let Some(civil) = date.strip_suffix('Z') {
        (civil, 0.0)
    } else {
        let at = date
            .char_indices()
            .rev()
            .find(|(i, c)| *i > 10 && matches!(c, '+' | '-'))?
            .0;
        (&date[..at], zone(&date[at..])?)
    };
    let values: Vec<_> = civil
        .split(['-', 'T', ' ', ':'])
        .map(str::parse::<i64>)
        .collect::<Result<_, _>>()
        .ok()?;
    let [mut year, month, day, hour, minute, second]: [i64; 6] =
        values.as_slice().try_into().ok()?;
    if !(1..=12).contains(&month)
        || !(0..=23).contains(&hour)
        || !(0..=59).contains(&minute)
        || !(0..=59).contains(&second)
    {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if !(1..=days_in_month).contains(&day) || !(1..=9999).contains(&year) {
        return None;
    }
    // Gregorian civil date to Unix days, matching cli_history's inverse conversion.
    year -= i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted_month + 2) / 5 + day - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    Some((
        days * 86400 + hour * 3600 + minute * 60 + second + (offset * 60.0) as i64,
        offset,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ssh_environment_overrides_config_and_uses_virtual_home_without_leaking() {
        let fs = crate::MemoryFs::new();
        fs.write_str(
            "/repo/.git/config",
            "[core]\nsshCommand = ssh -i /config-key -p 2222\n",
        );
        fs.write_str(
            "/custom/.ssh/config",
            "Host example.com\n  IdentityFile ~/.ssh/home-key\n",
        );
        let endpoint = crate::ssh::SshEndpoint {
            host: "example.com".into(),
            user: "git".into(),
            port: 22,
            path: "repo.git".into(),
            is_local_path: false,
        };
        {
            let _scope = EnvironmentScope::new(BTreeMap::from([("HOME".into(), "/custom".into())]));
            let cfg = crate::ssh::resolve_ssh_config(&fs, None, None, &endpoint);
            assert_eq!(cfg.identity_file.as_deref(), Some("/custom/.ssh/home-key"));
            assert_eq!(cfg.user_known_hosts_file, "/custom/.ssh/known_hosts");
            let _scope = EnvironmentScope::new(BTreeMap::from([
                ("HOME".into(), "/custom".into()),
                ("GIT_SSH_COMMAND".into(), "ssh -i /env-key -p 3333".into()),
            ]));
            let cfg = crate::ssh::resolve_ssh_config(&fs, None, Some("/repo/.git"), &endpoint);
            assert_eq!(cfg.identity_file.as_deref(), Some("/env-key"));
            assert_eq!(cfg.port, 3333);
        }
        assert_eq!(get("HOME"), None);
        assert_eq!(get("GIT_SSH_COMMAND"), None);
    }
}
