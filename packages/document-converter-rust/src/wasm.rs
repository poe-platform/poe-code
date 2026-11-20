//! Cooperative C ABI used by the import-free WebAssembly host.
use super::*;

/// Borrow a bundled font from static WASM memory. The returned frame uses the
/// same pointer/length packing as results, but must not be passed to document_free.
#[unsafe(no_mangle)]
pub extern "C" fn document_font(index: u32) -> u64 {
    let Some(bytes) = pdf_ast_rust::FONT_DATA.get(index as usize) else {
        return 0;
    };
    ((bytes.len() as u64) << 32) | bytes.as_ptr() as usize as u64
}
fn json_string(s: &str) -> Value {
    Value::String(s.encode_utf16().collect())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
#[unsafe(no_mangle)]
pub extern "C" fn document_alloc(len: usize) -> *mut u8 {
    if len > 256 * 1024 * 1024 {
        return std::ptr::null_mut();
    }
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(len).is_err() {
        return std::ptr::null_mut();
    }
    bytes.resize(len, 0u8);
    Box::into_raw(bytes.into_boxed_slice()) as *mut u8
}
/// # Safety
/// The pointer and length must be an allocation returned by this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn document_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
        }
    }
}
fn frame(result: Result<Output>) -> u64 {
    let mut output = Vec::new();
    match result {
        Ok(result) => {
            output.push(0);
            let metadata = json::stringify(&object(vec![
                (
                    "diagnostics",
                    Value::Array(
                        result
                            .diagnostics
                            .into_iter()
                            .map(|(code, message)| {
                                object(vec![
                                    ("code", json_string(code)),
                                    ("message", json_string(&message)),
                                ])
                            })
                            .collect(),
                    ),
                ),
                (
                    "usage",
                    object(
                        result
                            .usage
                            .into_iter()
                            .map(|(key, value)| (key, Value::Number(value as f64)))
                            .collect(),
                    ),
                ),
            ]));
            output.extend((metadata.len() as u32).to_le_bytes());
            output.extend(metadata.bytes());
            output.extend(result.bytes);
        }
        Err(error) => {
            output.push(1);
            output.extend(
                json::stringify(&object(vec![
                    ("code", json_string(error.code)),
                    ("message", json_string(&error.message)),
                ]))
                .bytes(),
            );
        }
    }
    let output = output.into_boxed_slice();
    let length = output.len();
    let address = Box::into_raw(output) as *mut u8 as usize;
    ((length as u64) << 32) | (address as u64)
}
pub struct Task {
    future: std::pin::Pin<Box<dyn std::future::Future<Output = Result<Output>>>>,
    result: Option<Result<Output>>,
}
/// # Safety
/// Takes ownership of an initialized `document_alloc` allocation of `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn document_start(ptr: *mut u8, len: usize, format: u32) -> *mut Task {
    let input = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    let future = Box::pin(async move {
        if format == 2 {
            drawing::render_async(&input).await
        } else if format > 2 {
            Err(Error::new("E_OPTION", "Unknown output format"))
        } else {
            convert_async(
                &input,
                if format == 0 {
                    Format::Docx
                } else {
                    Format::Pdf
                },
            )
            .await
        }
    });
    Box::into_raw(Box::new(Task {
        future,
        result: None,
    }))
}
/// # Safety
/// The pointer must reference a live task returned by `document_start`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn document_step(ptr: *mut Task) -> u32 {
    let task = unsafe { &mut *ptr };
    if task.result.is_some() {
        return 1;
    }
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    match task.future.as_mut().poll(&mut context) {
        std::task::Poll::Pending => 0,
        std::task::Poll::Ready(result) => {
            task.result = Some(result);
            1
        }
    }
}
/// # Safety
/// The pointer must reference a completed task returned by `document_start`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn document_result(ptr: *mut Task) -> u64 {
    let task = unsafe { &mut *ptr };
    frame(
        task.result
            .take()
            .unwrap_or_else(|| Err(Error::new("E_AST", "Conversion has not completed"))),
    )
}
/// # Safety
/// The pointer must reference a live task returned by `document_start`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn document_drop(ptr: *mut Task) {
    if !ptr.is_null() {
        unsafe {
            drop(Box::from_raw(ptr));
        }
    }
}
