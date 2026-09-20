//! Owned document resolution with host filesystem/path operations and own templates.
use crate::{
    Layer,
    discover::{self, Error},
    document::{self, Extends},
    merge_layers, prompt,
};
use config_mutations_rust::value::Value;
use toolcraft_design_rust::{
    data::{DataEnvironment, DataHost, Graph, Node},
    template::{self, Partials, RenderOptions},
};
#[derive(Clone, Debug)]
pub struct DocumentLayer {
    pub source: Vec<u16>,
    pub file_path: Vec<u16>,
    pub content: Vec<u16>,
    pub base_name: Option<Vec<u16>>,
}
#[derive(Clone, Debug)]
pub struct BaseLayer {
    pub source: Vec<u16>,
    pub path: Vec<u16>,
}
#[derive(Clone, Debug)]
pub enum ChainLayer {
    Data(Layer),
    Document(DocumentLayer),
    Base(BaseLayer),
}
#[derive(Default)]
pub struct Options<'a> {
    pub auto_extend: bool,
    pub validate: bool,
    pub view: Option<&'a Graph>,
}
#[derive(Debug)]
pub struct Resolved {
    pub data: Value,
    pub sources: Vec<(Vec<u16>, Vec<u16>)>,
    pub chain: Vec<Vec<u16>>,
}
/// Document/base layers prepared before foreign data layers are inspected.
#[derive(Debug)]
pub struct Prepared {
    pub document_index: usize,
    pub layers: Vec<Layer>,
    pub document_source: Vec<u16>,
    pub prompt_source: Option<Vec<u16>>,
    pub chain: Vec<Vec<u16>>,
}
pub trait Host: discover::Host {
    fn resolve(&mut self, path: &[u16]) -> Vec<u16>;
    fn dirname(&mut self, path: &[u16]) -> Vec<u16>;
    /// Basename with its extension removed.
    fn basename(&mut self, path: &[u16]) -> Vec<u16>;
    /// Lowercase extension, including its leading dot.
    fn extension(&mut self, path: &[u16]) -> Vec<u16>;
    fn is_absolute(&mut self, path: &[u16]) -> bool;
    /// Admit a document using the own parser; foreign hosts may preserve runtime values.
    fn admit(
        &mut self,
        content: &[u16],
        file: &[u16],
    ) -> Result<document::ParsedDocument, Error<Self::Error>> {
        let extension = self.extension(file);
        document::parse_document(
            content,
            &extension,
            file,
            &mut |path| self.is_absolute(path),
            None,
        )
        .map_err(|error| Error::Policy(error.message))
    }
    /// Render with the own data engine; foreign hosts may provide runtime views.
    fn render(
        &mut self,
        prompt: &[u16],
        options: &Options<'_>,
    ) -> Result<Vec<u16>, Error<Self::Error>> {
        let empty = Graph {
            nodes: vec![Node::Object(vec![])],
            root: 0,
        };
        let graph = options.view.unwrap_or(&empty);
        let mut partials = NoPartials;
        let mut environment = DataEnvironment::new(graph, &mut partials).map_err(template_error)?;
        template::render(
            prompt,
            0,
            &mut environment,
            RenderOptions {
                escape_none: true,
                validate: options.validate,
                ..RenderOptions::default()
            },
        )
        .map_err(template_error)
    }
    /// Own ENOTDIR is treated as missing only for path-valued extends.
    fn path_not_found(&self, _error: &Self::Error) -> bool {
        false
    }
}
fn u(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}
fn policy<E>(text: &str) -> Error<E> {
    Error::Policy(u(text))
}
fn named<E>(prefix: &str, name: &[u16], suffix: &str) -> Error<E> {
    let mut message = u(prefix);
    message.extend(name);
    message.extend(u(suffix));
    Error::Policy(message)
}
fn set_prompt(layer: &mut Layer, prompt: Vec<u16>) {
    let Value::Object(fields) = &mut layer.data else {
        unreachable!("Document layers have object roots")
    };
    if let Some((_, value)) = fields.iter_mut().find(|(key, _)| *key == u("prompt")) {
        *value = Value::String(prompt);
    } else {
        fields.push((u("prompt"), Value::String(prompt)));
    }
}
type BaseChain = (Vec<Layer>, Vec<Vec<u16>>);
type Partial = (Vec<u16>, Vec<u16>);
async fn load_bases<H: Host>(
    document: &DocumentLayer,
    extends: Extends,
    bases: &[BaseLayer],
    optional: bool,
    host: &mut H,
) -> Result<BaseChain, Error<H::Error>> {
    let mut layers = vec![];
    let mut files = vec![];
    let mut visited = vec![host.resolve(&document.file_path)];
    let mut name = document
        .base_name
        .clone()
        .unwrap_or_else(|| host.basename(&document.file_path));
    let mut from = document.file_path.clone();
    let mut value = extends;
    let mut optional = optional;
    let mut start = 0;
    for depth in 1.. {
        if depth > 5 {
            return Err(policy("Maximum extends depth exceeded (5)."));
        }
        let (content, file, source, next_start) = match value {
            Extends::Path(ref path) => {
                let directory = host.dirname(&from);
                let joined = host.join(&directory, path);
                let file = host.resolve(&joined);
                let content = match host.read(&file).await {
                    Ok(Some(content)) => content,
                    Ok(None) => return Err(named("base file not found at ", &file, "")),
                    Err(error) if host.path_not_found(&error) => {
                        return Err(named("base file not found at ", &file, ""));
                    }
                    Err(error) => return Err(Error::Host(error)),
                };
                (content, file.clone(), file, start)
            }
            _ => {
                let paths: Vec<_> = bases[start..]
                    .iter()
                    .map(|base| base.path.clone())
                    .collect();
                let discovered = match discover::find_base(&name, &paths, host).await {
                    Ok(discovered) => discovered,
                    Err(Error::Policy(message))
                        if optional && message.starts_with(&u("Base \"")) =>
                    {
                        break;
                    }
                    Err(error) => return Err(error),
                };
                let directory = host.dirname(&discovered.file_path);
                let directory = host.resolve(&directory);
                let index = bases[start..]
                    .iter()
                    .position(|base| host.resolve(&base.path) == directory)
                    .map(|index| index + start)
                    .ok_or_else(|| {
                        named(
                            "Resolved base is outside configured base paths: ",
                            &discovered.file_path,
                            "",
                        )
                    })?;
                (
                    discovered.content,
                    discovered.file_path,
                    bases[index].source.clone(),
                    index + 1,
                )
            }
        };
        let resolved = host.resolve(&file);
        if visited.contains(&resolved) {
            if optional {
                break;
            }
            let mut message = u("Circular extends detected.\nVisited files:\n- ");
            for (index, path) in visited.iter().chain(std::iter::once(&resolved)).enumerate() {
                if index > 0 {
                    message.extend(u("\n- "));
                }
                message.extend(path);
            }
            return Err(Error::Policy(message));
        }
        let parsed = host.admit(&content, &file)?;
        visited.push(resolved);
        files.push(file.clone());
        layers.push(Layer {
            source,
            data: parsed.yaml.value,
        });
        if parsed.extends == Extends::Disabled {
            break;
        }
        value = parsed.extends;
        name = host.basename(&file);
        from = file;
        optional = false;
        start = next_start;
    }
    Ok((layers, files))
}
async fn partial<H: Host>(
    name: &[u16],
    directories: &[Vec<u16>],
    host: &mut H,
) -> Result<Partial, Error<H::Error>> {
    let mut checked = vec![];
    for directory in directories {
        let mut file = name.to_vec();
        file.extend(u(".md"));
        let path = host.join(directory, &file);
        if !host.contains(directory, &path) {
            return Err(named(
                "Partial name must remain inside prompt directories: \"",
                name,
                "\".",
            ));
        }
        checked.push(path.clone());
        if let Some(content) = host.read(&path).await.map_err(Error::Host)? {
            return Ok((content, path));
        }
    }
    let mut message = u("Partial \"");
    message.extend(name);
    message.extend(u("\" not found.\nChecked paths:\n- "));
    for (index, path) in checked.iter().enumerate() {
        if index > 0 {
            message.extend(u("\n- "));
        }
        message.extend(path);
    }
    Err(Error::Policy(message))
}
fn template_error<E>(error: template::Error) -> Error<E> {
    Error::Policy(error.description)
}
async fn expand<H: Host>(
    document: &mut Layer,
    bases: &mut [Layer],
    files: &[Vec<u16>],
    host: &mut H,
) -> Result<Vec<Vec<u16>>, Error<H::Error>> {
    let mut directories = vec![];
    for file in files {
        let dir = host.dirname(file);
        if !directories.contains(&dir) {
            directories.push(dir);
        }
    }
    let mut partials: Vec<(Vec<u16>, Vec<u16>)> = vec![];
    let mut partial_files = vec![];
    for layer in std::iter::once(&*document).chain(bases.iter()) {
        let Some(Value::String(prompt)) = layer.data.get("prompt") else {
            continue;
        };
        let mut pending = template::partial_names(prompt)
            .map_err(template_error)?
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        while let Some(name) = pending.pop() {
            if name.iter().all(|unit|matches!(unit,9..=13|32|160|0xfeff|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000)){return Err(policy("Partial name must be non-empty."));}
            if partials.iter().any(|(key, _)| *key == name) {
                continue;
            }
            let (content, file) = partial(&name, &directories, host).await?;
            let nested = template::partial_names(&content).map_err(template_error)?;
            partials.push((name, content));
            partial_files.push(file);
            pending.extend(nested.into_iter().rev());
        }
    }
    for layer in std::iter::once(document).chain(bases.iter_mut()) {
        if let Some(Value::String(prompt)) = layer.data.get("prompt") {
            let prompt = template::expand_partials(prompt, &partials).map_err(template_error)?;
            set_prompt(layer, prompt);
        }
    }
    Ok(partial_files)
}
struct NoPartials;
impl Partials for NoPartials {
    fn has(&mut self, _name: &[u16]) -> Result<bool, template::Error> {
        Ok(false)
    }
    fn get(&mut self, name: &[u16]) -> Result<Vec<u16>, template::Error> {
        let mut description = u("Partial \"");
        description.extend(name);
        description.extend(u("\" not found."));
        Err(template::Error {
            description,
            line: None,
            column: None,
        })
    }
}
impl DataHost for NoPartials {}
pub async fn prepare<H: Host>(
    chain: &[ChainLayer],
    options: &Options<'_>,
    host: &mut H,
) -> Result<Prepared, Error<H::Error>> {
    let documents: Vec<_> = chain
        .iter()
        .enumerate()
        .filter_map(|(index, layer)| match layer {
            ChainLayer::Document(document) => Some((index, document)),
            _ => None,
        })
        .collect();
    if documents.len() != 1 {
        return Err(policy(&format!(
            "Exactly one document layer is required, received {}.",
            documents.len()
        )));
    }
    let (index, document) = documents[0];
    let bases: Vec<_> = chain
        .iter()
        .filter_map(|layer| match layer {
            ChainLayer::Base(base) => Some(base.clone()),
            _ => None,
        })
        .collect();
    let parsed = host.admit(&document.content, &document.file_path)?;
    let should_extend =
        parsed.extends != Extends::Disabled || options.auto_extend && !parsed.has_extends;
    let (mut base_layers, base_files) = if should_extend {
        let optional = parsed.extends == Extends::Disabled;
        load_bases(document, parsed.extends, &bases, optional, host).await?
    } else {
        (vec![], vec![])
    };
    let mut prompt_files = vec![document.file_path.clone()];
    prompt_files.extend(base_files);
    let mut expanded_document = Layer {
        source: document.source.clone(),
        data: parsed.yaml.value,
    };
    let partial_files = expand(
        &mut expanded_document,
        &mut base_layers,
        &prompt_files,
        host,
    )
    .await?;
    let composed = prompt::compose_prompts(&expanded_document, &base_layers).map_err(policy)?;
    if let Some(composed) = &composed {
        let prompt = if options.view.is_some() || options.validate {
            host.render(&composed.prompt, options)?
        } else {
            composed.prompt.clone()
        };
        set_prompt(&mut expanded_document, prompt);
        for index in &composed.consumed {
            let Value::Object(fields) = &mut base_layers[*index].data else {
                unreachable!()
            };
            fields.retain(|(key, _)| *key != u("prompt"));
        }
    }
    let mut layers = vec![expanded_document];
    layers.extend(base_layers);
    prompt_files.extend(partial_files);
    Ok(Prepared {
        document_index: index,
        layers,
        document_source: document.source.clone(),
        prompt_source: composed.and_then(|prompt| prompt.source),
        chain: prompt_files,
    })
}
/// Resolve owned layers after document preparation; foreign runtimes can defer their merge.
pub async fn resolve<H: Host>(
    chain: &[ChainLayer],
    options: &Options<'_>,
    host: &mut H,
) -> Result<Resolved, Error<H::Error>> {
    let prepared = prepare(chain, options, host).await?;
    let data_layers = |layers: &[ChainLayer]| {
        layers
            .iter()
            .filter_map(|layer| match layer {
                ChainLayer::Data(data) => Some(data.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    let mut layers = data_layers(&chain[..prepared.document_index]);
    layers.extend(prepared.layers);
    layers.extend(data_layers(&chain[prepared.document_index + 1..]));
    let mut merged = merge_layers(&layers).map_err(policy)?;
    if let Some(source) = prepared.prompt_source
        && let Some((_, provenance)) = merged
            .sources
            .iter_mut()
            .find(|(key, value)| *key == u("prompt") && *value == prepared.document_source)
    {
        *provenance = source;
    }
    Ok(Resolved {
        data: merged.data,
        sources: merged.sources,
        chain: prepared.chain,
    })
}
