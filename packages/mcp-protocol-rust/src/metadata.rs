use crate::json::Value;

pub fn is_valid_metadata_key(key: &[u16]) -> bool {
    let slash = key.iter().position(|unit| *unit == b'/' as u16);
    let name = if let Some(slash) = slash {
        if key[slash + 1..].contains(&(b'/' as u16)) {
            return false;
        }
        for label in key[..slash].split(|unit| *unit == b'.' as u16) {
            if !label.first().is_some_and(|unit| is_letter(*unit))
                || !label.last().is_some_and(|unit| is_alphanumeric(*unit))
            {
                return false;
            }
            if label
                .iter()
                .any(|unit| !is_alphanumeric(*unit) && *unit != b'-' as u16)
            {
                return false;
            }
        }
        &key[slash + 1..]
    } else {
        key
    };
    if name.is_empty() {
        return true;
    }
    name.first().is_some_and(|unit| is_alphanumeric(*unit))
        && name.last().is_some_and(|unit| is_alphanumeric(*unit))
        && name.iter().all(|unit| {
            is_alphanumeric(*unit) || [b'-' as u16, b'_' as u16, b'.' as u16].contains(unit)
        })
}

pub fn is_valid_metadata(value: &Value) -> bool {
    matches!(value, Value::Object(properties) if value.is_json_value() && properties.iter().all(|(key, _)| is_valid_metadata_key(key)))
}

fn is_letter(unit: u16) -> bool {
    (b'A' as u16..=b'Z' as u16).contains(&unit) || (b'a' as u16..=b'z' as u16).contains(&unit)
}

fn is_alphanumeric(unit: u16) -> bool {
    is_letter(unit) || (b'0' as u16..=b'9' as u16).contains(&unit)
}
