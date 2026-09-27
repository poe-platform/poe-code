//! Portable request/response boundary used by the safe-fs WebAssembly adapter.
use crate::http::{GitHttpRequest, GitHttpResponse, HttpClient};
use crate::{GitError, MemoryFs, execute_git_cli_with_http};
use mcp_protocol_rust::json::{self, Value};

fn string(value: &Value) -> Result<String, GitError> {
    match value {
        Value::String(s) => String::from_utf16(s).map_err(|_| GitError::internal("invalid UTF-16")),
        _ => Err(GitError::internal("expected string")),
    }
}
fn text(s: impl AsRef<str>) -> Value {
    Value::String(s.as_ref().encode_utf16().collect())
}
fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.encode_utf16().collect(), v))
            .collect(),
    )
}
fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value, GitError> {
    value
        .get(name)
        .ok_or_else(|| GitError::internal("missing portable field"))
}
fn bytes(value: &Value) -> Result<Vec<u8>, GitError> {
    let hex = string(value)?;
    if !hex.len().is_multiple_of(2) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(GitError::internal("invalid hex bytes"));
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|_| GitError::internal("invalid hex bytes"))
        })
        .collect()
}
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}
struct ReplayHttp {
    responses: Vec<Value>,
    cursor: std::sync::Mutex<usize>,
    pending: std::sync::Mutex<Option<Value>>,
}
impl HttpClient for ReplayHttp {
    fn request(&self, request: GitHttpRequest) -> Result<GitHttpResponse, GitError> {
        let mut cursor = self.cursor.lock().unwrap();
        if let Some(response) = self.responses.get(*cursor) {
            *cursor += 1;
            let headers = match field(response, "headers")? {
                Value::Object(entries) => entries
                    .iter()
                    .map(|(k, v)| {
                        Ok((
                            String::from_utf16(k)
                                .map_err(|_| GitError::internal("invalid header"))?,
                            string(v)?,
                        ))
                    })
                    .collect::<Result<_, GitError>>()?,
                _ => return Err(GitError::internal("expected response headers")),
            };
            let status_code = match field(response, "status")? {
                Value::Number(n) => *n as u16,
                _ => return Err(GitError::internal("expected HTTP status")),
            };
            return Ok(GitHttpResponse {
                url: request.url,
                method: request.method,
                status_code,
                status_message: String::new(),
                headers,
                body: bytes(field(response, "body")?)?,
            });
        }
        let headers = Value::Object(
            request
                .headers
                .iter()
                .map(|(k, v)| (k.encode_utf16().collect(), text(v)))
                .collect(),
        );
        *self.pending.lock().unwrap() = Some(object(vec![
            ("url", text(request.url)),
            ("method", text(request.method)),
            ("headers", headers),
            ("body", text(hex(&request.body))),
        ]));
        Err(GitError::internal("HTTP response required"))
    }
}

pub fn execute_portable(input: &[u8]) -> Result<Vec<u8>, GitError> {
    let request = json::parse(
        input,
        json::Limits {
            max_bytes: usize::MAX,
            max_nodes: usize::MAX,
            // Entries are flat; nesting is protocol structure, not filesystem depth.
            ..json::Limits::default()
        },
    )
    .map_err(|_| GitError::internal("invalid portable request"))?;
    let cwd = string(field(&request, "cwd")?)?;
    let Value::Array(args) = field(&request, "args")? else {
        return Err(GitError::internal("expected args"));
    };
    let args: Vec<_> = args.iter().map(string).collect::<Result<_, _>>()?;
    let Value::Array(entries) = field(&request, "entries")? else {
        return Err(GitError::internal("expected entries"));
    };
    let fs = MemoryFs::new();
    for entry in entries {
        let path = string(field(entry, "path")?)?;
        let kind = string(field(entry, "kind")?)?;
        let mode = match field(entry, "mode")? {
            Value::Number(n) => *n as u32,
            _ => return Err(GitError::internal("expected mode")),
        };
        match kind.as_str() {
            "directory" => {
                fs.mkdir(&path)
                    .map_err(|e| GitError::internal(&e.message))?;
            }
            "file" => fs.write_with_mode(&path, &bytes(field(entry, "data")?)?, mode),
            "symlink" => fs
                .writelink(&path, &bytes(field(entry, "data")?)?)
                .map_err(|e| GitError::internal(&e.message))?,
            _ => return Err(GitError::internal("unsupported filesystem entry")),
        }
    }
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let responses = match request.get("responses") {
        Some(Value::Array(r)) => r.clone(),
        _ => Vec::new(),
    };
    let http = ReplayHttp {
        responses,
        cursor: std::sync::Mutex::new(0),
        pending: std::sync::Mutex::new(None),
    };
    let result = execute_git_cli_with_http(&fs, &cwd, &args, &http);
    let pending_request = http.pending.lock().unwrap().take().unwrap_or(Value::Null);
    let mut output = Vec::new();
    let mut pending = vec!["/".to_string()];
    while let Some(dir) = pending.pop() {
        for name in fs
            .readdir(&dir)
            .map_err(|e| GitError::internal(&e.message))?
        {
            let path = crate::utils::join(&[&dir, &name]);
            let stat = fs
                .lstat(&path)
                .map_err(|e| GitError::internal(&e.message))?;
            let (kind, data) = if stat.is_directory() {
                pending.push(path.clone());
                ("directory", Vec::new())
            } else if stat.is_symbolic_link() {
                (
                    "symlink",
                    fs.readlink(&path)
                        .map_err(|e| GitError::internal(&e.message))?,
                )
            } else {
                (
                    "file",
                    fs.read_file(&path)
                        .map_err(|e| GitError::internal(&e.message))?,
                )
            };
            output.push(object(vec![
                ("path", text(path)),
                ("kind", text(kind)),
                ("mode", Value::Number(stat.mode as f64)),
                ("data", text(hex(&data))),
            ]));
        }
    }
    Ok(json::stringify(&object(vec![
        ("exitCode", Value::Number(result.exit_code as f64)),
        (
            "stdoutBytes",
            result
                .stdout_bytes
                .as_deref()
                .map(|bytes| text(hex(bytes)))
                .unwrap_or(Value::Null),
        ),
        ("stdout", text(result.stdout)),
        ("stderr", text(result.stderr)),
        ("entries", Value::Array(output)),
        ("request", pending_request),
    ]))
    .into_bytes())
}

#[cfg(target_arch = "wasm32")]
mod abi {
    use std::sync::Mutex;
    static OUTPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
    #[unsafe(no_mangle)]
    pub extern "C" fn git_alloc(length: usize) -> *mut u8 {
        let mut buffer = vec![0u8; length].into_boxed_slice();
        let ptr = buffer.as_mut_ptr();
        std::mem::forget(buffer);
        ptr
    }
    /// # Safety
    /// Pointer and length must identify a buffer returned by git_alloc exactly once.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn git_free(ptr: *mut u8, length: usize) {
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                ptr, length,
            )));
        }
    }
    /// # Safety
    /// Input must remain readable for length bytes for the duration of this call.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn git_execute(ptr: *const u8, length: usize) -> *const u8 {
        let result = super::execute_portable(unsafe { std::slice::from_raw_parts(ptr, length) });
        let mut output = OUTPUT.lock().unwrap();
        *output = result.unwrap_or_else(|e| {
            super::json::stringify(&super::object(vec![
                ("exitCode", super::Value::Number(128.0)),
                ("stdout", super::text("")),
                ("stderr", super::text(e.message)),
                ("entries", super::Value::Array(Vec::new())),
            ]))
            .into_bytes()
        });
        output.as_ptr()
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn git_output_len() -> usize {
        OUTPUT.lock().unwrap().len()
    }
}
