//! Futures are polled only on their originating Node thread; filesystem I/O is yielded.
use super::{NativeJson, object, snapshot_value, u};
use config_extends_rust::{
    Layer,
    discover::{self, Error as ResolutionError},
    document,
    prompt_document::{self, BaseDocument},
    resolve::{self, BaseLayer, ChainLayer, DocumentLayer, Options},
};
use config_mutations_rust::{snapshot, value::Value as V};
use mcp_protocol_rust::json::Value as J;
use napi::{Env, bindgen_prelude::*};
use napi_derive::napi;
use std::{
    cell::RefCell,
    future::Future,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};
type Callback = FunctionRef<FnArgs<(String, NativeJson)>, Buffer>;
#[derive(Debug)]
enum HostError {
    Foreign(u32, bool),
    Native(Error),
}
#[derive(Default)]
struct Io {
    request: Option<(&'static str, Vec<u16>)>,
    response: Option<std::result::Result<Option<Vec<u16>>, HostError>>,
    missing: Option<u32>,
}
struct Read {
    io: Rc<RefCell<Io>>,
}
impl Future for Read {
    type Output = std::result::Result<Option<Vec<u16>>, HostError>;
    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        match self.io.borrow_mut().response.take() {
            Some(value) => Poll::Ready(value),
            None => Poll::Pending,
        }
    }
}
struct Host {
    env: Env,
    callback: Callback,
    io: Rc<RefCell<Io>>,
    failure: Rc<RefCell<Option<HostError>>>,
}
fn invalid(text: &str) -> HostError {
    HostError::Native(Error::from_reason(text))
}
fn text(value: V) -> std::result::Result<Vec<u16>, HostError> {
    match value {
        V::String(value) => Ok(value),
        _ => Err(invalid("Expected host text")),
    }
}
fn field<'a>(value: &'a V, name: &str) -> std::result::Result<&'a V, HostError> {
    value
        .get(name)
        .ok_or_else(|| invalid(&format!("Missing resolution field: {name}")))
}
fn string(value: &V, name: &str) -> std::result::Result<Vec<u16>, HostError> {
    text(field(value, name)?.clone())
}
fn optional_text(value: &V, name: &str) -> Option<Vec<u16>> {
    match value.get(name) {
        Some(V::String(value)) => Some(value.clone()),
        _ => None,
    }
}
fn boolean(value: &V, name: &str) -> bool {
    matches!(value.get(name), Some(V::Bool(true)))
}
fn array<'a>(value: &'a V, name: &str) -> std::result::Result<&'a [V], HostError> {
    match value.get(name) {
        Some(V::Array(value)) => Ok(value),
        None => Ok(&[]),
        _ => Err(invalid("Expected resolution array")),
    }
}
fn id(value: &V) -> std::result::Result<u32, HostError> {
    match value {
        V::Number(value)
            if value.is_finite()
                && *value >= 0.0
                && *value <= f64::from(u32::MAX)
                && value.fract() == 0.0 =>
        {
            Ok(*value as u32)
        }
        _ => Err(invalid("Invalid foreign error handle")),
    }
}
impl Host {
    fn call(&self, operation: &str, arguments: Vec<J>) -> std::result::Result<V, HostError> {
        let function = self
            .callback
            .borrow_back(&self.env)
            .map_err(HostError::Native)?;
        let bytes = function
            .call((operation.to_owned(), NativeJson(J::Array(arguments))).into())
            .map_err(HostError::Native)?;
        let value = snapshot::decode(&bytes).map_err(invalid)?;
        if let Some(error) = value.get("bridgeError") {
            return Err(HostError::Foreign(id(error)?, false));
        }
        Ok(value)
    }
    fn path(&mut self, operation: &str, arguments: Vec<J>) -> Vec<u16> {
        if self.failure.borrow().is_some() {
            return vec![];
        }
        match self.call(operation, arguments).and_then(text) {
            Ok(value) => value,
            Err(error) => {
                *self.failure.borrow_mut() = Some(error);
                vec![]
            }
        }
    }
    fn predicate(&mut self, operation: &str, arguments: Vec<J>) -> bool {
        if self.failure.borrow().is_some() {
            return false;
        }
        match self.call(operation, arguments) {
            Ok(V::Bool(value)) => value,
            Ok(_) => {
                *self.failure.borrow_mut() = Some(invalid("Expected host predicate"));
                false
            }
            Err(error) => {
                *self.failure.borrow_mut() = Some(error);
                false
            }
        }
    }
    async fn lookup(
        &mut self,
        kind: &'static str,
        path: &[u16],
    ) -> std::result::Result<Option<Vec<u16>>, HostError> {
        self.io.borrow_mut().request = Some((kind, path.to_vec()));
        Read {
            io: self.io.clone(),
        }
        .await
    }
}
impl discover::Host for Host {
    type Error = HostError;
    fn join(&mut self, directory: &[u16], file: &[u16]) -> Vec<u16> {
        self.path(
            "join",
            vec![J::String(directory.to_vec()), J::String(file.to_vec())],
        )
    }
    fn contains(&mut self, directory: &[u16], file: &[u16]) -> bool {
        self.predicate(
            "contains",
            vec![J::String(directory.to_vec()), J::String(file.to_vec())],
        )
    }
    async fn read(&mut self, path: &[u16]) -> std::result::Result<Option<Vec<u16>>, HostError> {
        self.lookup("read", path).await
    }
}
impl resolve::Host for Host {
    fn resolve(&mut self, path: &[u16]) -> Vec<u16> {
        self.path("resolve", vec![J::String(path.to_vec())])
    }
    fn dirname(&mut self, path: &[u16]) -> Vec<u16> {
        self.path("dirname", vec![J::String(path.to_vec())])
    }
    fn basename(&mut self, path: &[u16]) -> Vec<u16> {
        self.path("basename", vec![J::String(path.to_vec())])
    }
    fn extension(&mut self, path: &[u16]) -> Vec<u16> {
        self.path("extension", vec![J::String(path.to_vec())])
    }
    fn is_absolute(&mut self, path: &[u16]) -> bool {
        self.predicate("absolute", vec![J::String(path.to_vec())])
    }
    fn path_not_found(&self, error: &HostError) -> bool {
        matches!(error, HostError::Foreign(_, true))
    }
    fn admit(
        &mut self,
        content: &[u16],
        file: &[u16],
    ) -> std::result::Result<document::ParsedDocument, ResolutionError<HostError>> {
        let extension = self.extension(file);
        let mut absolute_error = None;
        let mut date_error = None;
        let mut absolute =
            |path: &[u16]| match self.call("absolute", vec![J::String(path.to_vec())]) {
                Ok(V::Bool(value)) => value,
                Ok(_) => {
                    absolute_error = Some(invalid("Expected absolute path predicate"));
                    false
                }
                Err(error) => {
                    absolute_error = Some(error);
                    false
                }
            };
        let mut date_key = |epoch: i64| match self
            .call("dateKey", vec![J::Number(epoch as f64)])
            .and_then(text)
        {
            Ok(value) => value,
            Err(error) => {
                date_error = Some(error);
                vec![]
            }
        };
        let parsed = document::parse_document(
            content,
            &extension,
            file,
            &mut absolute,
            Some(&mut date_key),
        );
        if let Some(error) = absolute_error.or(date_error) {
            return Err(ResolutionError::Host(error));
        }
        let mut parsed = match parsed {
            Ok(parsed) => parsed,
            Err(error) => {
                // Error-only admission preserves Node JSON diagnostics and frontmatter classes.
                if let Err(error) = self.call(
                    "parseError",
                    vec![J::String(content.to_vec()), J::String(file.to_vec())],
                ) {
                    return Err(ResolutionError::Host(error));
                }
                return Err(ResolutionError::Policy(error.message));
            }
        };
        let mut temporals = vec![];
        let mut date_index = 0;
        let mut symbol_index = 0;
        let mut pending = vec![&mut parsed.yaml.value];
        while let Some(value) = pending.pop() {
            match value {
                V::Date(date) => {
                    let alias = parsed.yaml.date_ids.get(date_index).ok_or_else(|| {
                        ResolutionError::Host(invalid("Missing admitted date identity"))
                    })?;
                    date_index += 1;
                    let temporal = J::Array(vec![
                        J::String(u("date")),
                        J::Number(*alias as f64),
                        J::Number(date.epoch_millis as f64),
                    ]);
                    *value = V::Unsupported(u(&temporals.len().to_string()));
                    temporals.push(temporal);
                }
                V::Symbol(description) => {
                    let alias = parsed.yaml.symbol_ids.get(symbol_index).ok_or_else(|| {
                        ResolutionError::Host(invalid("Missing admitted symbol identity"))
                    })?;
                    symbol_index += 1;
                    let temporal = J::Array(vec![
                        J::String(u("symbol")),
                        J::Number(*alias as f64),
                        J::String(description.clone()),
                    ]);
                    *value = V::Unsupported(u(&temporals.len().to_string()));
                    temporals.push(temporal);
                }
                V::Object(fields) => {
                    pending.extend(fields.iter_mut().rev().map(|(_, value)| value))
                }
                V::Array(items) => pending.extend(items.iter_mut().rev()),
                _ => {}
            }
        }
        if !temporals.is_empty() {
            let handles = self
                .call("temporals", vec![J::Array(temporals)])
                .map_err(ResolutionError::Host)?;
            let V::Array(handles) = handles else {
                return Err(ResolutionError::Host(invalid("Expected temporal handles")));
            };
            let mut pending = vec![&mut parsed.yaml.value];
            while let Some(value) = pending.pop() {
                match value {
                    V::Unsupported(local) => {
                        let local = String::from_utf16(local)
                            .ok()
                            .and_then(|value| value.parse::<usize>().ok())
                            .and_then(|index| handles.get(index))
                            .ok_or_else(|| {
                                ResolutionError::Host(invalid("Invalid temporal handle index"))
                            })?;
                        *value = V::Unsupported(u(&id(local)
                            .map_err(ResolutionError::Host)?
                            .to_string()));
                    }
                    V::Object(fields) => {
                        pending.extend(fields.iter_mut().rev().map(|(_, value)| value))
                    }
                    V::Array(items) => pending.extend(items.iter_mut().rev()),
                    _ => {}
                }
            }
        }
        parsed.yaml.date_ids.clear();
        parsed.yaml.symbol_ids.clear();
        Ok(parsed)
    }
    fn render(
        &mut self,
        prompt: &[u16],
        options: &Options<'_>,
    ) -> std::result::Result<Vec<u16>, ResolutionError<HostError>> {
        self.call(
            "render",
            vec![J::String(prompt.to_vec()), J::Bool(options.validate)],
        )
        .and_then(text)
        .map_err(ResolutionError::Host)
    }
}
impl prompt_document::Host for Host {
    async fn realpath(&mut self, path: &[u16]) -> std::result::Result<Option<Vec<u16>>, HostError> {
        self.lookup("realpath", path).await
    }
    fn missing_document(&mut self, path: &[u16]) -> ResolutionError<HostError> {
        if let Some(error) = self.io.borrow().missing {
            return ResolutionError::Host(HostError::Foreign(error, false));
        }
        let mut message = u("Prompt document not found: ");
        message.extend(path);
        ResolutionError::Policy(message)
    }
}
fn error_value(error: ResolutionError<HostError>) -> Result<J> {
    Ok(match error {
        ResolutionError::Policy(message) => object(vec![("error", J::String(message))]),
        ResolutionError::Host(HostError::Foreign(id, _)) => {
            object(vec![("foreignError", J::Number(f64::from(id)))])
        }
        ResolutionError::Host(HostError::Native(error)) => return Err(error),
    })
}
fn prepared(value: resolve::Prepared) -> Result<J> {
    let mut references = vec![];
    let layers = value
        .layers
        .into_iter()
        .enumerate()
        .map(|(index, layer)| {
            let data = snapshot_value(
                layer.data,
                &mut vec![
                    J::String(u("layers")),
                    J::Number(index as f64),
                    J::String(u("data")),
                ],
                &mut references,
            )?;
            Ok(object(vec![
                ("source", J::String(layer.source)),
                ("data", data),
            ]))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(object(vec![
        ("documentIndex", J::Number(value.document_index as f64)),
        ("layers", J::Array(layers)),
        ("documentSource", J::String(value.document_source)),
        (
            "promptSource",
            value.prompt_source.map_or(J::Null, J::String),
        ),
        (
            "chain",
            J::Array(value.chain.into_iter().map(J::String).collect()),
        ),
        ("references", J::Array(references)),
    ]))
}
fn chain(value: &V) -> std::result::Result<Vec<ChainLayer>, HostError> {
    array(value, "chain")?
        .iter()
        .map(|layer| {
            match String::from_utf16_lossy(&string(layer, "kind")?).as_str() {
                "document" => Ok(ChainLayer::Document(DocumentLayer {
                    source: string(layer, "source")?,
                    file_path: string(layer, "filePath")?,
                    content: string(layer, "content")?,
                    base_name: optional_text(layer, "baseName"),
                })),
                "base" => Ok(ChainLayer::Base(BaseLayer {
                    source: string(layer, "source")?,
                    path: string(layer, "path")?,
                })),
                // Foreign data is intentionally absent until the final Node merge.
                _ => Ok(ChainLayer::Data(Layer {
                    source: vec![],
                    data: V::Object(vec![]),
                })),
            }
        })
        .collect()
}
async fn run(mode: String, config: V, mut host: Host) -> Result<J> {
    let operation = async {
        match mode.as_str() {
            "findBase" => {
                let name = string(&config, "name")?;
                let bases = array(&config, "bases")?
                    .iter()
                    .cloned()
                    .map(text)
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                match discover::find_base(&name, &bases, &mut host).await {
                    Ok(result) => Ok(object(vec![
                        ("content", J::String(result.content)),
                        ("filePath", J::String(result.file_path)),
                    ])),
                    Err(error) => error_value(error).map_err(HostError::Native),
                }
            }
            "resolve" => {
                let chain = chain(&config)?;
                let empty = toolcraft_empty();
                let options = Options {
                    auto_extend: boolean(&config, "autoExtend"),
                    validate: boolean(&config, "validate"),
                    view: boolean(&config, "hasView").then_some(&empty),
                };
                match resolve::prepare(&chain, &options, &mut host).await {
                    Ok(result) => prepared(result).map_err(HostError::Native),
                    Err(error) => error_value(error).map_err(HostError::Native),
                }
            }
            "promptDocument" => {
                let empty = toolcraft_empty();
                let mut input = prompt_document::Input::new(
                    string(&config, "cwd")?,
                    string(&config, "filePath")?,
                );
                input.content = optional_text(&config, "content");
                input.optional = boolean(&config, "optional");
                input.base_paths = array(&config, "basePaths")?
                    .iter()
                    .cloned()
                    .map(text)
                    .collect::<std::result::Result<_, _>>()?;
                input.base_documents = array(&config, "baseDocuments")?
                    .iter()
                    .map(|value| {
                        Ok(BaseDocument {
                            file_path: string(value, "filePath")?,
                            content: string(value, "content")?,
                        })
                    })
                    .collect::<std::result::Result<_, HostError>>()?;
                input.variables = Some(&empty);
                input.validate = match config.get("validate") {
                    Some(V::Bool(value)) => Some(*value),
                    _ => None,
                };
                match prompt_document::resolve_prompt_document(&input, &mut host).await {
                    Ok(result) => {
                        let mut references = vec![];
                        let metadata = snapshot_value(
                            result.metadata,
                            &mut vec![J::String(u("metadata"))],
                            &mut references,
                        )
                        .map_err(HostError::Native)?;
                        Ok(object(vec![
                            ("template", J::String(result.template)),
                            ("prompt", J::String(result.prompt)),
                            ("metadata", metadata),
                            (
                                "sources",
                                J::Object(
                                    result
                                        .sources
                                        .into_iter()
                                        .map(|(key, value)| (key, J::String(value)))
                                        .collect(),
                                ),
                            ),
                            ("source", J::String(result.source)),
                            (
                                "chain",
                                J::Array(result.chain.into_iter().map(J::String).collect()),
                            ),
                            ("references", J::Array(references)),
                        ]))
                    }
                    Err(error) => error_value(error).map_err(HostError::Native),
                }
            }
            _ => Err(invalid("Unknown resolution mode")),
        }
    }
    .await;
    match operation {
        Ok(value) => Ok(value),
        Err(error) => error_value(ResolutionError::Host(error)),
    }
}
fn toolcraft_empty() -> toolcraft_design_rust::data::Graph {
    toolcraft_design_rust::data::Graph {
        root: 0,
        nodes: vec![toolcraft_design_rust::data::Node::Object(vec![])],
    }
}
type Work = Pin<Box<dyn Future<Output = Result<J>>>>;
#[napi]
pub struct ExtendsResolution {
    work: Option<Work>,
    io: Rc<RefCell<Io>>,
    failure: Rc<RefCell<Option<HostError>>>,
}
#[napi]
impl ExtendsResolution {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            work: None,
            io: Rc::new(RefCell::new(Io::default())),
            failure: Rc::new(RefCell::new(None)),
        }
    }
    #[napi]
    pub fn reset(
        &mut self,
        env: Env,
        mode: String,
        config: Buffer,
        callback: Function<FnArgs<(String, NativeJson)>, Buffer>,
    ) -> Result<()> {
        if self.work.is_some() {
            return Err(Error::from_reason("Resolution is already running"));
        }
        *self.io.borrow_mut() = Io::default();
        *self.failure.borrow_mut() = None;
        let config = snapshot::decode(&config).map_err(Error::from_reason)?;
        let host = Host {
            env,
            callback: callback.create_ref()?,
            io: self.io.clone(),
            failure: self.failure.clone(),
        };
        self.work = Some(Box::pin(run(mode, config, host)));
        Ok(())
    }
    #[napi]
    pub fn advance(&mut self, response: Option<Buffer>) -> Result<NativeJson> {
        if let Some(response) = response {
            let value = snapshot::decode(&response).map_err(Error::from_reason)?;
            let response = if let Some(error) = value.get("error") {
                Err(HostError::Foreign(
                    id(error).map_err(|_| Error::from_reason("Invalid response error"))?,
                    boolean(&value, "notdir"),
                ))
            } else if let Some(error) = value.get("missing") {
                self.io.borrow_mut().missing =
                    Some(id(error).map_err(|_| Error::from_reason("Invalid missing error"))?);
                Ok(None)
            } else {
                match value.get("value") {
                    Some(V::String(value)) => Ok(Some(value.clone())),
                    _ => return Err(Error::from_reason("Invalid filesystem response")),
                }
            };
            self.io.borrow_mut().response = Some(response);
        }
        let Some(work) = self.work.as_mut() else {
            return Err(Error::from_reason("No active resolution"));
        };
        let poll = work.as_mut().poll(&mut Context::from_waker(Waker::noop()));
        let failure = self.failure.borrow_mut().take();
        if let Some(failure) = failure {
            self.discard();
            return Ok(NativeJson(error_value(ResolutionError::Host(failure))?));
        }
        match poll {
            Poll::Ready(result) => {
                self.discard();
                result.map(NativeJson)
            }
            Poll::Pending => {
                let request =
                    self.io.borrow_mut().request.take().ok_or_else(|| {
                        Error::from_reason("Suspended without a filesystem request")
                    })?;
                Ok(NativeJson(object(vec![
                    ("request", J::String(u(request.0))),
                    ("path", J::String(request.1)),
                ])))
            }
        }
    }
    #[napi]
    pub fn discard(&mut self) {
        self.work = None;
        *self.io.borrow_mut() = Io::default();
        *self.failure.borrow_mut() = None;
    }
}
