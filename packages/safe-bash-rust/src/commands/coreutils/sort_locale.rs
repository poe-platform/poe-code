use std::{cmp::Ordering, collections::BTreeMap};

pub(super) struct Collator(platform::Collator);

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
            && let Some(collator) = platform::Collator::open(&language)
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

#[cfg(target_arch = "wasm32")]
mod platform {
    use super::Ordering;
    #[link(wasm_import_module = "safe_bash")]
    unsafe extern "C" {
        fn sort_collator_open(tag: *const u8, len: usize) -> u32;
        fn sort_collator_compare(
            id: u32,
            a: *const u8,
            alen: usize,
            b: *const u8,
            blen: usize,
        ) -> i32;
        fn sort_collator_close(id: u32);
    }
    pub(super) struct Collator(u32);
    impl Collator {
        pub fn open(tag: &str) -> Option<Self> {
            let id = unsafe { sort_collator_open(tag.as_ptr(), tag.len()) };
            (id != 0).then(|| Self(id))
        }
        pub fn compare(&self, a: &str, b: &str) -> Result<Ordering, String> {
            Ok(
                unsafe { sort_collator_compare(self.0, a.as_ptr(), a.len(), b.as_ptr(), b.len()) }
                    .cmp(&0),
            )
        }
    }
    impl Drop for Collator {
        fn drop(&mut self) {
            unsafe { sort_collator_close(self.0) }
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
#[path = "sort_locale/native.rs"]
mod platform;

#[cfg(not(any(
    target_arch = "wasm32",
    target_os = "linux",
    target_os = "macos",
    windows
)))]
mod platform {
    use super::Ordering;
    pub(super) enum Collator {}
    impl Collator {
        pub fn open(_: &str) -> Option<Self> {
            None
        }
        pub fn compare(&self, _: &str, _: &str) -> Result<Ordering, String> {
            match *self {}
        }
    }
}
