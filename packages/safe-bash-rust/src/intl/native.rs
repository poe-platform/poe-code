// Bind ICU's stable C API when a native command requests locale or time zone data.
// Keep the library loaded for the lifetime of the cached function pointers.
use super::Ordering;
use std::{
    ffi::{CStr, CString, c_char, c_void},
    ptr::NonNull,
    sync::OnceLock,
};

type Ptr = *mut c_void;
// Declare each stable ABI signature once, alongside its exported name.
macro_rules! icu_api {
    ($($field:ident: $symbol:ident => $ty:ty),+ $(,)?) => {
        struct Icu { $($field: $ty),+ }
        impl Icu {
            fn bind(lib: Ptr, suffix: &str) -> Option<Self> {
                Some(Self { $($field: {
                    let name = CString::new(format!("{}{suffix}", stringify!($symbol))).unwrap();
                    let address = NonNull::new(library::symbol(lib, &name))?;
                    unsafe { std::mem::transmute::<Ptr, $ty>(address.as_ptr()) }
                }),+ })
            }
        }
    }
}
icu_api! {
    zone_ids: ucal_openTimeZones => unsafe extern "C" fn(*mut i32)->Ptr,
    enum_next: uenum_next => unsafe extern "C" fn(Ptr,*mut i32,*mut i32)->*const c_char,
    enum_close: uenum_close => unsafe extern "C" fn(Ptr),
    date_open: udat_open => unsafe extern "C" fn(i32,i32,*const c_char,*const u16,i32,*const u16,i32,*mut i32)->Ptr,
    date_close: udat_close => unsafe extern "C" fn(Ptr),
    date_format: udat_format => unsafe extern "C" fn(Ptr,f64,*mut u16,i32,Ptr,*mut i32)->i32,
    from_tag: uloc_forLanguageTag => unsafe extern "C" fn(*const c_char,*mut c_char,i32,*mut i32,*mut i32)->i32,
    count: ucol_countAvailable => unsafe extern "C" fn()->i32,
    available: ucol_getAvailable => unsafe extern "C" fn(i32)->*const c_char,
    resource: ures_openDirect => unsafe extern "C" fn(*const c_char,*const c_char,*mut i32)->Ptr,
    child: ures_getByKey => unsafe extern "C" fn(Ptr,*const c_char,Ptr,*mut i32)->Ptr,
    string: ures_getStringByKey => unsafe extern "C" fn(Ptr,*const c_char,*mut i32,*mut i32)->*const u16,
    close_resource: ures_close => unsafe extern "C" fn(Ptr),
    open: ucol_open => unsafe extern "C" fn(*const c_char,*mut i32)->Ptr,
    close: ucol_close => unsafe extern "C" fn(Ptr),
    attribute: ucol_setAttribute => unsafe extern "C" fn(Ptr,i32,i32,*mut i32),
    compare: ucol_strcollUTF8 => unsafe extern "C" fn(Ptr,*const u8,i32,*const u8,i32,*mut i32)->i32,
}

#[cfg(unix)]
mod library {
    use super::*;
    #[cfg_attr(target_os = "linux", link(name = "dl"))]
    unsafe extern "C" {
        fn dlopen(path: *const c_char, flags: i32) -> Ptr;
        fn dlsym(handle: Ptr, name: *const c_char) -> Ptr;
        fn dlclose(handle: Ptr) -> i32;
    }
    pub(super) fn open() -> Ptr {
        #[cfg(target_os = "macos")]
        return unsafe { dlopen(c"/usr/lib/libicucore.A.dylib".as_ptr(), 2) };
        #[cfg(target_os = "linux")]
        {
            let handle = unsafe { dlopen(c"libicui18n.so".as_ptr(), 2) };
            if !handle.is_null() {
                return handle;
            }
            // Runtime-only distributions omit the development .so symlink.
            for major in (50..=u8::MAX).rev() {
                let path = CString::new(format!("libicui18n.so.{major}")).unwrap();
                let handle = unsafe { dlopen(path.as_ptr(), 2) };
                if !handle.is_null() {
                    return handle;
                }
            }
            std::ptr::null_mut()
        }
    }
    pub(super) fn symbol(handle: Ptr, name: &CStr) -> Ptr {
        unsafe { dlsym(handle, name.as_ptr()) }
    }
    pub(super) fn close(handle: Ptr) {
        unsafe {
            dlclose(handle);
        }
    }
}

#[cfg(windows)]
mod library {
    use super::*;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LoadLibraryExW(name: *const u16, file: Ptr, flags: u32) -> Ptr;
        fn GetProcAddress(handle: Ptr, name: *const c_char) -> Ptr;
        fn FreeLibrary(handle: Ptr) -> i32;
    }
    pub(super) fn open() -> Ptr {
        let dll: Vec<_> = "icu.dll\0".encode_utf16().collect();
        unsafe { LoadLibraryExW(dll.as_ptr(), std::ptr::null_mut(), 0x800) } // LOAD_LIBRARY_SEARCH_SYSTEM32
    }
    pub(super) fn symbol(handle: Ptr, name: &CStr) -> Ptr {
        unsafe { GetProcAddress(handle, name.as_ptr()) }
    }
    pub(super) fn close(handle: Ptr) {
        unsafe {
            FreeLibrary(handle);
        }
    }
}

impl Icu {
    fn load() -> Option<Self> {
        let lib = NonNull::new(library::open())?.as_ptr();
        // Some builds export the unsuffixed API, others suffix all symbols
        // with their ICU major. strcollUTF8 was added in ICU 50.
        let api = (|| {
            let suffix = if !library::symbol(lib, c"ucol_open").is_null() {
                String::new()
            } else {
                (50..=u8::MAX)
                    .rev()
                    .find(|v| {
                        !library::symbol(lib, &CString::new(format!("ucol_open_{v}")).unwrap())
                            .is_null()
                    })
                    .map(|v| format!("_{v}"))?
            };
            Self::bind(lib, &suffix)
        })();
        if api.is_none() {
            library::close(lib);
        }
        api
    }

    fn supports_language(&self, language: &str) -> bool {
        (0..unsafe { (self.count)() }).any(|i| {
            // ucol_getAvailable returns a static locale ID for each index.
            let id = unsafe { CStr::from_ptr((self.available)(i)) }.to_bytes();
            id.split(|&b| b == b'_').next() == Some(language.as_bytes())
        })
    }

    fn language_alias(&self, language: &str) -> Option<String> {
        let language = CString::new(language).ok()?;
        let mut status = 0;
        // Read CLDR's canonical replacement (for example, sh -> sr_Latn).
        // Do not select an unrelated supported language by linguistic distance.
        unsafe {
            let mut entry = NonNull::new((self.resource)(
                std::ptr::null(),
                c"metadata".as_ptr(),
                &mut status,
            ))?;
            for key in [c"alias", c"language", &language] {
                let next = (self.child)(
                    entry.as_ptr(),
                    key.as_ptr(),
                    std::ptr::null_mut(),
                    &mut status,
                );
                (self.close_resource)(entry.as_ptr());
                entry = NonNull::new(next)?;
            }
            let mut len = 0;
            let value = (self.string)(
                entry.as_ptr(),
                c"replacement".as_ptr(),
                &mut len,
                &mut status,
            );
            let alias = if status <= 0 && !value.is_null() && len > 0 {
                String::from_utf16(std::slice::from_raw_parts(value, len as usize)).ok()
            } else {
                None
            };
            (self.close_resource)(entry.as_ptr());
            alias
        }
    }

    fn locale_id(&self, tag: &str) -> Option<String> {
        let len = i32::try_from(tag.len()).ok()?;
        let tag = CString::new(tag).ok()?;
        let mut buf = vec![0; 128];
        loop {
            let mut consumed = 0;
            let mut status = 0;
            let needed = unsafe {
                (self.from_tag)(
                    tag.as_ptr(),
                    buf.as_mut_ptr().cast(),
                    buf.len().try_into().ok()?,
                    &mut consumed,
                    &mut status,
                )
            };
            if needed >= 0 && needed as usize >= buf.len() {
                buf.resize(needed as usize + 1, 0);
            } else if status > 0 || consumed != len {
                return None;
            } else {
                buf.truncate(usize::try_from(needed).ok()?);
                return String::from_utf8(buf).ok();
            }
        }
    }
}

pub(crate) struct Collator {
    icu: &'static Icu,
    coll: NonNull<c_void>,
}

impl Collator {
    pub fn open(tag: &str, lower_first: bool) -> Option<Self> {
        let icu = ICU.get_or_init(Icu::load).as_ref()?;
        // ICU accepts some grandfathered and extlang tags that ECMA-402
        // rejects. Check the Unicode language identifier before its extensions.
        let mut parts = tag.split('-');
        let lang = parts.next()?;
        if !(2..=8).contains(&lang.len())
            || lang.len() == 4
            || !lang.bytes().all(|c| c.is_ascii_alphabetic())
        {
            return None;
        }
        let mut base = parts.take_while(|p| p.len() != 1).peekable();
        base.next_if(|p| p.len() == 4 && p.bytes().all(|c| c.is_ascii_alphabetic()));
        base.next_if(|p| {
            p.len() == 2 && p.bytes().all(|c| c.is_ascii_alphabetic())
                || p.len() == 3 && p.bytes().all(|c| c.is_ascii_digit())
        });
        if base.any(|p| {
            !((5..=8).contains(&p.len()) || p.len() == 4 && p.as_bytes()[0].is_ascii_digit())
        }) {
            return None;
        }

        // ICU parses and normalizes extensions, keeping the first occurrence
        // of a key (as Intl.Collator does for co, kn and kf).
        let parsed = icu.locale_id(tag)?;
        let (base, keywords) = parsed.split_once('@').unwrap_or((&parsed, ""));
        let mut fields = base.split('_');
        let mut language = fields.next()?.to_ascii_lowercase();
        let mut subtags: Vec<_> = fields.collect();
        let alias;
        if !subtags.is_empty() || !icu.supports_language(&language) {
            let lookup = base
                .split('_')
                .filter(|p| !p.is_empty())
                .map(|p| {
                    if p.len() > 4 {
                        p.to_ascii_lowercase()
                    } else {
                        p.to_owned()
                    }
                })
                .collect::<Vec<_>>()
                .join("_");
            alias = icu.language_alias(&lookup);
            if let Some(full) = &alias {
                let mut fields = full.split('_');
                language = fields.next()?.to_owned();
                subtags = fields.collect();
            }
        }
        let primary_alias;
        if !icu.supports_language(&language) {
            primary_alias = icu.language_alias(&language)?;
            let mut fields = primary_alias.split('_');
            language = fields.next()?.to_owned();
            if !icu.supports_language(&language) {
                return None;
            }
            for extra in fields {
                if extra.len() == 4
                    && !subtags
                        .first()
                        .is_some_and(|p| p.len() == 4 && p.as_bytes()[0].is_ascii_alphabetic())
                {
                    subtags.insert(0, extra);
                } else if matches!(extra.len(), 2 | 3)
                    && !subtags.iter().any(|p| matches!(p.len(), 2 | 3))
                {
                    let after_script =
                        usize::from(subtags.first().is_some_and(|p| {
                            p.len() == 4 && p.as_bytes()[0].is_ascii_alphabetic()
                        }));
                    subtags.insert(after_script, extra);
                }
            }
        }
        let mut locale = language;
        for field in subtags {
            locale.push('_');
            locale.push_str(field);
        }
        let mut numeric = false;
        let mut case_first = -1; // UCOL_DEFAULT: preserve the locale’s case order.
        for option in keywords.split(';') {
            if let Some(value) = option.strip_prefix("collation=")
                && !matches!(value, "search" | "standard")
            {
                locale.push('@');
                locale.push_str(option);
            } else if option == "colnumeric=yes" {
                numeric = true;
            } else if let Some(value) = option.strip_prefix("colcasefirst=") {
                case_first = match value {
                    "lower" => 24,
                    "upper" => 25,
                    "no" => 16,
                    _ => -1,
                };
            }
        }
        let locale = CString::new(locale).ok()?;
        let mut status = 0;
        let coll = Self {
            icu,
            coll: NonNull::new(unsafe { (icu.open)(locale.as_ptr(), &mut status) })?,
        };
        // ucol.h: CASE_FIRST from caller or locale, CASE_LEVEL=OFF, NORMALIZATION=ON,
        // STRENGTH=TERTIARY, NUMERIC_COLLATION from the kn extension.
        for (attribute, value) in [
            (2, if lower_first { 24 } else { case_first }),
            (3, 16),
            (4, 17),
            (5, 2),
            (7, if numeric { 17 } else { 16 }),
        ] {
            unsafe { (icu.attribute)(coll.coll.as_ptr(), attribute, value, &mut status) };
        }
        (status <= 0).then_some(coll)
    }
    pub fn compare(&self, a: &str, b: &str) -> Result<Ordering, String> {
        let len = |s: &str| {
            i32::try_from(s.len()).map_err(|_| "EFBIG: collation text too long".to_owned())
        };
        let mut status = 0;
        let result = unsafe {
            (self.icu.compare)(
                self.coll.as_ptr(),
                a.as_ptr(),
                len(a)?,
                b.as_ptr(),
                len(b)?,
                &mut status,
            )
        };
        if status > 0 {
            Err("EIO: collation comparison failed".into())
        } else {
            Ok(result.cmp(&0))
        }
    }
}
impl Drop for Collator {
    fn drop(&mut self) {
        unsafe { (self.icu.close)(self.coll.as_ptr()) };
    }
}

static ICU: OnceLock<Option<Icu>> = OnceLock::new();

struct ZoneFormatter {
    name: String,
    fmt: NonNull<c_void>,
    icu: &'static Icu,
}

impl Drop for ZoneFormatter {
    fn drop(&mut self) {
        unsafe { (self.icu.date_close)(self.fmt.as_ptr()) };
    }
}

impl ZoneFormatter {
    fn open(name: &str) -> Option<Self> {
        let icu = ICU.get_or_init(Icu::load).as_ref()?;
        let mut status = 0;
        // ICU silently falls back to GMT for unknown IDs. Match a real ID
        // case-insensitively, like Intl.DateTimeFormat, before opening it.
        let ids = NonNull::new(unsafe { (icu.zone_ids)(&mut status) })?;
        let mut zone = None;
        while status <= 0 {
            let mut len = 0;
            let id = unsafe { (icu.enum_next)(ids.as_ptr(), &mut len, &mut status) };
            if id.is_null() {
                break;
            }
            // The enumeration owns the NUL-terminated ID until the next call.
            let id = unsafe { CStr::from_ptr(id) }.to_bytes();
            if id.eq_ignore_ascii_case(name.as_bytes()) {
                zone = Some(id.iter().map(|&c| u16::from(c)).collect::<Vec<_>>());
                break;
            }
        }
        unsafe { (icu.enum_close)(ids.as_ptr()) };
        let zone = zone?;
        let pattern: Vec<_> = "xxxxx'|'z".encode_utf16().collect();
        let fmt = NonNull::new(unsafe {
            (icu.date_open)(
                -2,
                -2,
                c"en_US".as_ptr(),
                zone.as_ptr(),
                zone.len() as i32,
                pattern.as_ptr(),
                pattern.len() as i32,
                &mut status,
            )
        })?;
        let result = Self {
            name: name.to_owned(),
            fmt,
            icu,
        };
        (status <= 0).then_some(result)
    }

    fn fields(&self, seconds: i64) -> Option<(i64, String)> {
        let mut text = [0u16; 128];
        let mut status = 0;
        let n = unsafe {
            (self.icu.date_format)(
                self.fmt.as_ptr(),
                seconds as f64 * 1000.0,
                text.as_mut_ptr(),
                text.len() as i32,
                std::ptr::null_mut(),
                &mut status,
            )
        };
        if status > 0 {
            return None;
        }
        let value = String::from_utf16(text.get(..usize::try_from(n).ok()?)?).ok()?;
        let (offset, label) = value.split_once('|')?;
        let mut parts = offset.get(1..)?.split(':');
        let h = parts.next()?.parse::<i64>().ok()?;
        let m = parts.next()?.parse::<i64>().ok()?;
        let s = parts.next().unwrap_or("0").parse::<i64>().ok()?;
        Some((
            (3600 * h + 60 * m + s) * if offset.starts_with('-') { -1 } else { 1 },
            label.to_owned(),
        ))
    }
}

pub(crate) fn zone_fields(name: &str, seconds: i64) -> Option<(i64, String)> {
    thread_local! { static FORMATTER: std::cell::RefCell<Option<ZoneFormatter>> = const { std::cell::RefCell::new(None) }; }
    FORMATTER.with_borrow_mut(|cached| {
        if !cached.as_ref().is_some_and(|f| f.name == name) {
            *cached = Some(ZoneFormatter::open(name)?);
        }
        cached.as_ref()?.fields(seconds)
    })
}
