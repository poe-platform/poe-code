//! Revision date limits use the request clock and timezone, including in WASM.
pub(crate) fn parse(value: &str) -> i64 {
    let timestamp = crate::environment::timestamp();
    let zone = crate::environment::get("TZ")
        .and_then(|name| jiff::tz::TimeZone::get(&name).ok())
        .unwrap_or(jiff::tz::TimeZone::UTC);
    let Ok(now) = jiff::Timestamp::from_second(timestamp) else {
        return timestamp;
    };
    let now = now.to_zoned(zone);
    // Git's date-only revision limits preserve the current local time of day.
    if let Ok(date) = value.parse::<jiff::civil::Date>() {
        return date
            .to_datetime(now.time())
            .to_zoned(now.offset().to_time_zone())
            .map(|date| date.timestamp().as_second())
            .unwrap_or(timestamp);
    }
    // Like Git's approxidate, unrecognized input falls back to now.
    gix_date::parse(value, Some(now))
        .map(|date| date.seconds)
        .unwrap_or(timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::environment::EnvironmentScope;
    use std::{collections::BTreeMap, process::Command};

    #[test]
    fn dates_match_native_git_without_creating_a_repository() {
        for zone in ["UTC", "America/Chicago"] {
            let _scope = EnvironmentScope::new(BTreeMap::from([
                ("POE_GIT_TIMESTAMP".into(), "1800036100".into()),
                ("TZ".into(), zone.into()),
            ]));
            for date in [
                "2026-10-01",
                "2027-01-15T08:01:40Z",
                "2027-01-15 10:01:40 +0200",
                "Fri, 15 Jan 2027 08:01:40 +0000",
                "@1800000100",
                "1800000100 +0000",
                "10 hours ago",
                "2 days 3 hours ago",
                "1.week.ago",
                "last month",
                "yesterday",
                "now",
                "garbage",
            ] {
                let output = Command::new("git")
                    .args(["rev-parse", &format!("--since={date}")])
                    .env("TZ", zone)
                    .env("GIT_TEST_DATE_NOW", "1800036100")
                    .output()
                    .unwrap();
                assert!(output.status.success());
                assert_eq!(
                    format!("--max-age={}\n", parse(date)),
                    String::from_utf8(output.stdout).unwrap(),
                    "{date} ({zone})"
                );
            }
        }
    }
}
