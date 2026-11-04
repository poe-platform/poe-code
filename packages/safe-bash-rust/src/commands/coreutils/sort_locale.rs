use std::{cmp::Ordering, collections::BTreeMap};

pub(super) struct Collator(crate::intl::Collator);

impl Collator {
    pub fn from_env(env: &BTreeMap<String, String>) -> Result<Option<Self>, String> {
        let locale = ["LC_ALL", "LC_COLLATE", "LANG"]
            .iter()
            .find_map(|key| env.get(*key).filter(|v| !v.is_empty()))
            .map_or("C", String::as_str);
        if matches!(locale, "C" | "POSIX" | "C.UTF-8" | "C.utf8") {
            return Ok(None);
        }
        let language = locale.split('.').next().unwrap().replace('_', "-");
        if !locale.contains('@')
            && let Some(collator) = crate::intl::Collator::open(&language, true)
        {
            return Ok(Some(Self(collator)));
        }
        Err(format!("sort: unsupported collation locale '{locale}'\n"))
    }

    pub fn compare(&self, left: &[u8], right: &[u8]) -> Result<Ordering, String> {
        // The reference's fatal UTF-8 decoder consumes one leading BOM.
        match (std::str::from_utf8(left), std::str::from_utf8(right)) {
            (Ok(a), Ok(b)) => self.0.compare(
                a.strip_prefix('\u{feff}').unwrap_or(a),
                b.strip_prefix('\u{feff}').unwrap_or(b),
            ),
            (Ok(_), Err(_)) => Ok(Ordering::Less),
            (Err(_), Ok(_)) => Ok(Ordering::Greater),
            (Err(_), Err(_)) => Ok(left.cmp(right)),
        }
    }
}
