use config_mutations_rust::mock::{self, Action, MockMachine, Operation, Request};
use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
#[napi]
pub struct ConfigMockMachine {
    machine: Option<MockMachine>,
}
fn s(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn value(result: std::result::Result<Request, Vec<u16>>) -> NativeJson {
    let request = match result {
        Ok(request) => request,
        Err(message) => return NativeJson(super::object(vec![("error", Value::String(message))])),
    };
    let (kind, extra) = match request {
        Request::Exclusive => ("exclusive", vec![]),
        Request::Recursive => ("recursive", vec![]),
        Request::File => ("file", vec![]),
        Request::Directory => ("directory", vec![]),
        Request::Parent => ("parent", vec![]),
        Request::Error(error) => (
            "failure",
            vec![
                ("code", s(error.code)),
                ("message", Value::String(error.message)),
            ],
        ),
        Request::Done(action) => {
            let (name, extra) = match action {
                Action::Read => ("read", vec![]),
                Action::Write => ("write", vec![]),
                Action::Mkdir(recursive) => ("mkdir", vec![("recursive", Value::Bool(recursive))]),
                Action::Delete => ("delete", vec![]),
                Action::Rename => ("rename", vec![]),
                Action::Stat(mode) => ("stat", vec![("mode", Value::Number(mode as f64))]),
                Action::Link => ("link", vec![]),
                Action::List => ("list", vec![]),
                Action::Noop => ("noop", vec![]),
                Action::Exists(flag) => ("exists", vec![("exists", Value::Bool(flag))]),
            };
            let mut fields = vec![("action", s(name))];
            fields.extend(extra);
            ("done", fields)
        }
    };
    let mut fields = vec![("kind", s(kind))];
    fields.extend(extra);
    NativeJson(super::object(fields))
}
#[napi]
impl ConfigMockMachine {
    #[napi(constructor)]
    pub fn new(operation: String, target: Utf16String) -> Result<Self> {
        let operation = match operation.as_str() {
            "readFile" => Operation::Read,
            "writeFile" => Operation::Write,
            "mkdir" => Operation::Mkdir,
            "unlink" => Operation::Unlink,
            "rename" => Operation::Rename,
            "stat" => Operation::Stat,
            "lstat" => Operation::Lstat,
            "readdir" => Operation::List,
            "chmod" => Operation::Chmod,
            "exists" => Operation::Exists,
            _ => return Err(Error::from_reason("Unsupported mock operation")),
        };
        Ok(Self {
            machine: Some(MockMachine::new(operation, target.to_vec())),
        })
    }
    #[napi]
    pub fn start(&mut self) -> Result<NativeJson> {
        Ok(value(
            self.machine
                .as_mut()
                .ok_or_else(|| Error::from_reason("Mock operation already discarded"))?
                .start(),
        ))
    }
    #[napi]
    pub fn respond(&mut self, flag: bool) -> Result<NativeJson> {
        Ok(value(
            self.machine
                .as_mut()
                .ok_or_else(|| Error::from_reason("Mock operation already discarded"))?
                .respond(flag),
        ))
    }
    #[napi]
    pub fn discard(&mut self) {
        self.machine = None;
    }
}
#[napi]
pub fn config_mock_directory_parts(path: Utf16String, separator: u32) -> Result<NativeJson> {
    let separator =
        u16::try_from(separator).map_err(|_| Error::from_reason("Invalid path separator"))?;
    Ok(NativeJson(Value::Array(
        mock::directory_parts(&path, separator)
            .into_iter()
            .map(Value::String)
            .collect(),
    )))
}
