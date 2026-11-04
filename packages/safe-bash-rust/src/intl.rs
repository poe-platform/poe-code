use std::cmp::Ordering;

pub(crate) use platform::{Collator, zone_fields};

#[cfg(target_arch = "wasm32")]
mod platform {
    use super::Ordering;
    #[link(wasm_import_module = "safe_bash")]
    unsafe extern "C" {
        fn collator_open(tag: *const u8, len: usize, lower_first: bool) -> u32;
        fn collator_compare(id: u32, a: *const u8, alen: usize, b: *const u8, blen: usize) -> i32;
        fn collator_close(id: u32);
        fn timezone_fields(
            name: *const u8,
            len: usize,
            seconds: f64,
            offset: *mut i32,
            label: *mut u8,
            capacity: usize,
        ) -> i32;
    }
    pub(crate) fn zone_fields(name: &str, seconds: i64) -> Option<(i64, String)> {
        let mut label = [0; 128];
        let mut offset = 0;
        let n = unsafe {
            timezone_fields(
                name.as_ptr(),
                name.len(),
                seconds as f64,
                &mut offset,
                label.as_mut_ptr(),
                label.len(),
            )
        };
        Some((
            offset.into(),
            std::str::from_utf8(label.get(..usize::try_from(n).ok()?)?)
                .ok()?
                .to_owned(),
        ))
    }
    pub(crate) struct Collator(u32);
    impl Collator {
        pub fn open(tag: &str, lower_first: bool) -> Option<Self> {
            let id = unsafe { collator_open(tag.as_ptr(), tag.len(), lower_first) };
            (id != 0).then(|| Self(id))
        }
        pub fn compare(&self, a: &str, b: &str) -> Result<Ordering, String> {
            Ok(
                unsafe { collator_compare(self.0, a.as_ptr(), a.len(), b.as_ptr(), b.len()) }
                    .cmp(&0),
            )
        }
    }
    impl Drop for Collator {
        fn drop(&mut self) {
            unsafe { collator_close(self.0) }
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
#[path = "intl/native.rs"]
mod platform;

#[cfg(not(any(
    target_arch = "wasm32",
    target_os = "linux",
    target_os = "macos",
    windows
)))]
mod platform {
    use super::Ordering;
    pub(crate) fn zone_fields(_: &str, _: i64) -> Option<(i64, String)> {
        None
    }
    pub(crate) enum Collator {}
    impl Collator {
        pub fn open(_: &str, _: bool) -> Option<Self> {
            None
        }
        pub fn compare(&self, _: &str, _: &str) -> Result<Ordering, String> {
            match *self {}
        }
    }
}
