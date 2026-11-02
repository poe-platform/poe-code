// Bind ICU's stable C API only when a native sort requests a locale.
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

pub(super) struct Collator {
    icu: &'static Icu,
    coll: NonNull<c_void>,
}

impl Collator {
    pub fn open(tag: &str) -> Option<Self> {
        static ICU: OnceLock<Option<Icu>> = OnceLock::new();
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
        // of a key. Only co and kn affect sort; its caseFirst is always lower.
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
        for option in keywords.split(';') {
            if let Some(value) = option.strip_prefix("collation=")
                && !matches!(value, "search" | "standard")
            {
                locale.push('@');
                locale.push_str(option);
            } else if option == "colnumeric=yes" {
                numeric = true;
            }
        }
        let locale = CString::new(locale).ok()?;
        let mut status = 0;
        let coll = Self {
            icu,
            coll: NonNull::new(unsafe { (icu.open)(locale.as_ptr(), &mut status) })?,
        };
        // ucol.h: CASE_FIRST=LOWER_FIRST, CASE_LEVEL=OFF, NORMALIZATION=ON,
        // STRENGTH=TERTIARY, NUMERIC_COLLATION from the kn extension.
        for (attribute, value) in [
            (2, 24),
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
