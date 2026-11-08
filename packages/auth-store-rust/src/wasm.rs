//! Small UTF-16 ABI: all values are owned during execution and no host callbacks run.
use mcp_protocol_rust::json::{self, Limits, Value};
use std::cell::RefCell;
thread_local! { static OUTPUT: RefCell<Vec<u16>> = const { RefCell::new(Vec::new()) }; }

#[unsafe(no_mangle)]
pub extern "C" fn credential_alloc(length: usize) -> *mut u16 {
    Box::into_raw(vec![0u16; length].into_boxed_slice()).cast()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn credential_free(pointer: *mut u16, length: usize) {
    // The host returns exactly the allocation pointer and length, once.
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            pointer, length,
        )));
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn credential_run(
    operation: u32,
    pointer: *const u16,
    length: usize,
) -> *const u16 {
    let input = unsafe { std::slice::from_raw_parts(pointer, length) };
    let result = json::parse_utf16(input, Limits::default())
        .map_err(|_| "Invalid portable policy input")
        .and_then(|value| crate::portable::dispatch(operation, &value));
    let envelope = match result {
        Ok(value) => Value::Object(vec![("value".encode_utf16().collect(), value)]),
        Err(message) => Value::Object(vec![(
            "error".encode_utf16().collect(),
            Value::String(message.encode_utf16().collect()),
        )]),
    };
    OUTPUT.with(|output| {
        let mut output = output.borrow_mut();
        *output = json::stringify(&envelope).encode_utf16().collect();
        output.as_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn credential_result_length() -> usize {
    OUTPUT.with(|output| output.borrow().len())
}
