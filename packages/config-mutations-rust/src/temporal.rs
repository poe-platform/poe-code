//! Gregorian dates with TOML's local/offset distinctions, independent of host TZ.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Temporal {
    pub epoch_millis: i64,
    pub has_date: bool,
    pub has_time: bool,
    pub offset: Option<Vec<u16>>,
}
fn decimal(text: &[u16]) -> Option<i64> {
    if text.is_empty() {
        return None;
    }
    let mut value = 0i64;
    for ch in text {
        if !(48..=57).contains(ch) {
            return None;
        }
        value = value.checked_mul(10)?.checked_add(i64::from(*ch - 48))?;
    }
    Some(value)
}
fn civil_days(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let y = year - era * 400;
    let m = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * m + 2) / 5 + day - 1;
    era * 146097 + y * 365 + y / 4 - y / 100 + day_of_year - 719468
}
fn date_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719468;
    let era = days.div_euclid(146097);
    let day_of_era = days - era * 146097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let m = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * m + 2) / 5 + 1;
    let month = m + if m < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}
fn utc_iso(epoch: i64) -> Vec<u16> {
    let days = epoch.div_euclid(86400000);
    let rest = epoch.rem_euclid(86400000);
    let (y, m, d) = date_from_days(days);
    let year = if (0..=9999).contains(&y) {
        format!("{y:04}")
    } else if y < 0 {
        format!("-{:06}", -y)
    } else {
        format!("+{y:06}")
    };
    format!(
        "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3600000,
        rest / 60000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
    .encode_utf16()
    .collect()
}
fn offset_minutes(offset: &[u16]) -> Option<i64> {
    if matches!(offset, [90] | [122]) {
        return Some(0);
    }
    if offset.len() != 6 || !matches!(offset[0], 43 | 45) || offset[3] != 58 {
        return None;
    }
    let hours = decimal(&offset[1..3])?;
    let minutes = decimal(&offset[4..])?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some((hours * 60 + minutes) * if offset[0] == 45 { -1 } else { 1 })
}
impl Temporal {
    pub fn parse(source: &[u16]) -> Option<Self> {
        let has_date = source.len() >= 10 && source[4] == 45 && source[7] == 45;
        let (year, month, day, mut pos) = if has_date {
            (
                decimal(&source[..4])?,
                decimal(&source[5..7])?,
                decimal(&source[8..10])?,
                10,
            )
        } else {
            (0, 1, 1, 0)
        };
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        if pos == source.len() {
            return has_date.then_some(Self {
                epoch_millis: civil_days(year, month, day) * 86400000,
                has_date,
                has_time: false,
                offset: None,
            });
        }
        if has_date {
            if !matches!(source.get(pos), Some(84 | 116 | 32)) {
                return None;
            }
            pos += 1;
        }
        let start = pos;
        if source.get(pos + 2) != Some(&58) {
            return None;
        }
        let hour = decimal(source.get(pos..pos + 2)?)?;
        let minute = decimal(source.get(pos + 3..pos + 5)?)?;
        pos += 5;
        let mut second = 0;
        let mut millis = 0;
        if source.get(pos) == Some(&58) {
            second = decimal(source.get(pos + 1..pos + 3)?)?;
            pos += 3;
            if source.get(pos) == Some(&46) {
                pos += 1;
                let digits = pos;
                while matches!(source.get(pos), Some(48..=57)) {
                    if pos - digits < 3 {
                        millis = millis * 10 + i64::from(source[pos] - 48);
                    }
                    pos += 1;
                }
                if digits == pos {
                    return None;
                }
                for _ in pos - digits..3 {
                    millis *= 10;
                }
            }
        }
        if hour > 23 || minute > 59 || second > 59 || start == pos {
            return None;
        }
        let offset = if pos < source.len() {
            Some(source[pos..].to_vec())
        } else {
            None
        };
        let adjustment = match offset.as_deref() {
            None => 0,
            Some(offset) => offset_minutes(offset)?,
        };
        Some(Self {
            epoch_millis: civil_days(year, month, day) * 86400000
                + hour * 3600000
                + minute * 60000
                + second * 1000
                + millis
                - adjustment * 60000,
            has_date,
            has_time: true,
            offset,
        })
    }
    pub fn is_date(&self) -> bool {
        self.has_date && !self.has_time
    }
    pub fn is_time(&self) -> bool {
        self.has_time && !self.has_date
    }
    pub fn is_local(&self) -> bool {
        !self.has_date || !self.has_time || self.offset.is_none()
    }
    pub fn to_iso_string(&self) -> Vec<u16> {
        let iso = utc_iso(self.epoch_millis);
        if self.is_date() {
            return iso[..10].to_vec();
        }
        if self.is_time() {
            return iso[11..23].to_vec();
        }
        match self.offset.as_deref() {
            None => iso[..iso.len() - 1].to_vec(),
            Some([90]) => iso,
            Some(offset) => {
                let shifted = self
                    .epoch_millis
                    .saturating_add(offset_minutes(offset).unwrap_or(0) * 60000);
                let mut iso = utc_iso(shifted);
                iso.pop();
                iso.extend_from_slice(offset);
                iso
            }
        }
    }
}
