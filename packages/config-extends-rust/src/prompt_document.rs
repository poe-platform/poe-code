//! Rooted prompt documents, including in-memory base overlays and symlink checks.
use crate::{
    discover::{self, Error},
    resolve::{self, BaseLayer, ChainLayer, DocumentLayer, Options},
};
use config_mutations_rust::value::Value;
use toolcraft_design_rust::data::{Graph, Node};
pub trait Host: resolve::Host {
    /// Report an absent mandatory document; foreign hosts may retain its original exception.
    fn missing_document(&mut self, path: &[u16]) -> Error<Self::Error> {
        named("Prompt document not found: ", path)
    }
    /// None is an own ENOENT; errors must not be reclassified as missing files.
    fn realpath(
        &mut self,
        path: &[u16],
    ) -> impl std::future::Future<Output = Result<Option<Vec<u16>>, Self::Error>>;
}
#[derive(Clone, Debug)]
pub struct BaseDocument {
    pub file_path: Vec<u16>,
    pub content: Vec<u16>,
}
pub struct Input<'a> {
    pub cwd: Vec<u16>,
    pub file_path: Vec<u16>,
    pub content: Option<Vec<u16>>,
    pub optional: bool,
    pub base_paths: Vec<Vec<u16>>,
    pub base_documents: Vec<BaseDocument>,
    pub variables: Option<&'a Graph>,
    pub validate: Option<bool>,
}
impl Input<'_> {
    pub fn new(cwd: Vec<u16>, file_path: Vec<u16>) -> Self {
        Self {
            cwd,
            file_path,
            content: None,
            optional: false,
            base_paths: vec![],
            base_documents: vec![],
            variables: None,
            validate: None,
        }
    }
}
#[derive(Debug)]
pub struct Resolved {
    pub template: Vec<u16>,
    pub prompt: Vec<u16>,
    pub metadata: Value,
    pub sources: Vec<(Vec<u16>, Vec<u16>)>,
    pub source: Vec<u16>,
    pub chain: Vec<Vec<u16>>,
}
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn named<E>(prefix: &str, path: &[u16]) -> Error<E> {
    let mut message = u(prefix);
    message.extend(path);
    Error::Policy(message)
}
fn inside<H: resolve::Host>(host: &mut H, file: &[u16], root: &[u16]) -> bool {
    let file = host.resolve(file);
    let root = host.resolve(root);
    file == root || host.contains(&root, &file)
}
fn absolute<H: Host>(host: &mut H, path: &[u16], label: &str) -> Result<Vec<u16>, Error<H::Error>> {
    if !host.is_absolute(path) {
        return Err(named(&format!("{label} must be absolute: "), path));
    }
    Ok(host.resolve(path))
}
struct Rooted<'a, H> {
    host: &'a mut H,
    roots: Vec<Vec<u16>>,
    documents: Vec<BaseDocument>,
}
impl<H: Host> discover::Host for Rooted<'_, H> {
    type Error = Error<H::Error>;
    fn join(&mut self, directory: &[u16], file: &[u16]) -> Vec<u16> {
        self.host.join(directory, file)
    }
    fn contains(&mut self, directory: &[u16], file: &[u16]) -> bool {
        inside(self.host, file, directory)
    }
    async fn read(&mut self, file: &[u16]) -> Result<Option<Vec<u16>>, Self::Error> {
        let normalized = self.host.resolve(file);
        let overlay = self
            .documents
            .iter()
            .rev()
            .find(|document| document.file_path == normalized);
        let resolved = if overlay.is_some() {
            normalized.clone()
        } else {
            let Some(path) = self.host.realpath(file).await.map_err(Error::Host)? else {
                return Ok(None);
            };
            self.host.resolve(&path)
        };
        let root = self
            .roots
            .iter()
            .find(|root| inside(self.host, file, root))
            .ok_or_else(|| named("Prompt document path escapes configured root: ", file))?;
        let canonical_root = match self.host.realpath(root).await {
            Ok(Some(path)) => self.host.resolve(&path),
            _ => self.host.resolve(root),
        };
        if !inside(self.host, &resolved, &canonical_root) {
            return Err(named(
                "Prompt document path escapes configured root: ",
                file,
            ));
        }
        if let Some(document) = overlay {
            return Ok(Some(document.content.clone()));
        }
        self.host.read(file).await.map_err(Error::Host)
    }
}
impl<H: Host> resolve::Host for Rooted<'_, H> {
    fn resolve(&mut self, path: &[u16]) -> Vec<u16> {
        self.host.resolve(path)
    }
    fn dirname(&mut self, path: &[u16]) -> Vec<u16> {
        self.host.dirname(path)
    }
    fn basename(&mut self, path: &[u16]) -> Vec<u16> {
        self.host.basename(path)
    }
    fn extension(&mut self, path: &[u16]) -> Vec<u16> {
        self.host.extension(path)
    }
    fn is_absolute(&mut self, path: &[u16]) -> bool {
        self.host.is_absolute(path)
    }
    fn admit(
        &mut self,
        content: &[u16],
        file: &[u16],
    ) -> Result<crate::document::ParsedDocument, Error<Self::Error>> {
        self.host.admit(content, file).map_err(Error::Host)
    }
    fn render(
        &mut self,
        prompt: &[u16],
        options: &Options<'_>,
    ) -> Result<Vec<u16>, Error<Self::Error>> {
        self.host.render(prompt, options).map_err(Error::Host)
    }
    fn path_not_found(&self, error: &Self::Error) -> bool {
        matches!(error,Error::Host(error) if self.host.path_not_found(error))
    }
}
fn flatten<E>(error: Error<Error<E>>) -> Error<E> {
    match error {
        Error::Policy(message) => Error::Policy(message),
        Error::Host(error) => error,
    }
}
fn prompt<E>(data: &Value, file: &[u16]) -> Result<Vec<u16>, Error<E>> {
    let Some(Value::String(prompt)) = data.get("prompt") else {
        return Err(named(
            "Prompt document does not resolve to a Markdown prompt: ",
            file,
        ));
    };
    Ok(prompt.clone())
}
pub async fn resolve_prompt_document<H: Host>(
    input: &Input<'_>,
    host: &mut H,
) -> Result<Resolved, Error<H::Error>> {
    let cwd = host.resolve(&input.cwd);
    let file_path = if host.is_absolute(&input.file_path) {
        host.resolve(&input.file_path)
    } else {
        let joined = host.join(&cwd, &input.file_path);
        host.resolve(&joined)
    };
    if !inside(host, &file_path, &cwd) {
        return Err(named(
            "Prompt document path must remain inside cwd: ",
            &file_path,
        ));
    }
    let mut documents = vec![];
    for document in &input.base_documents {
        documents.push(BaseDocument {
            file_path: absolute(
                host,
                &document.file_path,
                "Prompt document base document paths",
            )?,
            content: document.content.clone(),
        });
    }
    let mut base_paths = vec![];
    for path in &input.base_paths {
        base_paths.push(absolute(host, path, "Prompt document base paths")?);
    }
    base_paths.extend(
        documents
            .iter()
            .map(|document| host.dirname(&document.file_path)),
    );
    let mut roots = vec![cwd];
    roots.extend(base_paths.iter().cloned());
    let mut fs = Rooted {
        host,
        roots,
        documents,
    };
    let content = match &input.content {
        Some(content) => content.clone(),
        None => match discover::Host::read(&mut fs, &file_path).await? {
            Some(content) => content,
            None if input.optional => u("---\nextends: true\n---\n"),
            None => return Err(fs.host.missing_document(&file_path)),
        },
    };
    let mut chain = vec![ChainLayer::Document(DocumentLayer {
        source: u("document"),
        file_path: file_path.clone(),
        content,
        base_name: None,
    })];
    chain.extend(base_paths.into_iter().enumerate().map(|(index, path)| {
        ChainLayer::Base(BaseLayer {
            source: u(&format!("base-{}", index + 1)),
            path,
        })
    }));
    let composed = resolve::resolve(&chain, &Options::default(), &mut fs)
        .await
        .map_err(flatten)?;
    let empty = Graph {
        root: 0,
        nodes: vec![Node::Object(vec![])],
    };
    let rendered = resolve::resolve(
        &chain,
        &Options {
            view: Some(input.variables.unwrap_or(&empty)),
            validate: input.validate.unwrap_or(true),
            auto_extend: false,
        },
        &mut fs,
    )
    .await
    .map_err(flatten)?;
    let template = prompt(&composed.data, &file_path)?;
    let prompt = prompt(&rendered.data, &file_path)?;
    let mut metadata = rendered.data;
    let Value::Object(fields) = &mut metadata else {
        unreachable!()
    };
    fields.retain(|(key, _)| *key != u("prompt"));
    Ok(Resolved {
        template,
        prompt,
        metadata,
        sources: rendered.sources,
        source: file_path,
        chain: rendered.chain,
    })
}
