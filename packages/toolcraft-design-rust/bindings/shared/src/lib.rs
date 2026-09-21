use mcp_protocol_rust::json::Value;
use mcp_protocol_rust_napi_core::convert::NativeJson;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_design_rust::template::{self, Environment, Lookup, Partials, ValueKind};
#[napi(object)]
pub struct Reply {
    pub hit: bool,
    pub truthy: bool,
    pub nullish: bool,
    pub kind: u32,
    pub handle: u32,
    pub empty: bool,
    pub done: bool,
    pub text: Utf16String,
}
type Callback<'a> = Function<'a, FnArgs<(u32, u32, u32, Utf16String, Vec<Utf16String>)>, Reply>;
struct Host<'a> {
    callback: Callback<'a>,
    error: Option<Error>,
}
impl Host<'_> {
    fn call(
        &mut self,
        op: u32,
        handle: usize,
        context: usize,
        text: &[u16],
        stack: &[Vec<u16>],
    ) -> std::result::Result<Reply, template::Error> {
        self.callback
            .call(FnArgs::from((
                op,
                handle as u32,
                context as u32,
                text.to_vec().into(),
                stack.iter().cloned().map(Into::into).collect(),
            )))
            .map_err(|error| {
                if self.error.is_none() {
                    self.error = Some(error);
                }
                template::Error {
                    description: "Template host callback failed".encode_utf16().collect(),
                    line: None,
                    column: None,
                }
            })
    }
}
impl Partials for Host<'_> {
    fn has(&mut self, name: &[u16]) -> std::result::Result<bool, template::Error> {
        Ok(self.call(6, 0, 0, name, &[])?.hit)
    }
    fn get(&mut self, name: &[u16]) -> std::result::Result<Vec<u16>, template::Error> {
        Ok(self.call(7, 0, 0, name, &[])?.text.to_vec())
    }
}
impl Environment for Host<'_> {
    fn lookup(
        &mut self,
        context: usize,
        name: &[u16],
    ) -> std::result::Result<Lookup, template::Error> {
        let value = self.call(0, 0, context, name, &[])?;
        Ok(Lookup {
            hit: value.hit,
            truthy: value.truthy,
            nullish: value.nullish,
            kind: match value.kind {
                1 => ValueKind::Object,
                2 => ValueKind::String,
                3 => ValueKind::Number,
                4 => ValueKind::Array,
                5 => ValueKind::Function,
                _ => ValueKind::Other,
            },
            handle: value.handle as usize,
            empty: value.empty,
        })
    }
    fn text(&mut self, handle: usize) -> std::result::Result<Vec<u16>, template::Error> {
        Ok(self.call(1, handle, 0, &[], &[])?.text.to_vec())
    }
    fn push(
        &mut self,
        parent: usize,
        handle: usize,
    ) -> std::result::Result<usize, template::Error> {
        Ok(self.call(2, handle, parent, &[], &[])?.handle as usize)
    }
    fn iterate(&mut self, handle: usize) -> std::result::Result<usize, template::Error> {
        Ok(self.call(3, handle, 0, &[], &[])?.handle as usize)
    }
    fn next(&mut self, iterator: usize) -> std::result::Result<Option<usize>, template::Error> {
        let value = self.call(4, iterator, 0, &[], &[])?;
        Ok(if value.done {
            None
        } else {
            Some(value.handle as usize)
        })
    }
    fn close(&mut self, iterator: usize) {
        let _ = self.call(5, iterator, 0, &[], &[]);
    }
    fn lambda(
        &mut self,
        handle: usize,
        context: usize,
        raw: &[u16],
        stack: &[Vec<u16>],
    ) -> std::result::Result<Vec<u16>, template::Error> {
        Ok(self.call(8, handle, context, raw, stack)?.text.to_vec())
    }
}
fn object(parts: Vec<(&str, Value)>) -> Value {
    Value::Object(
        parts
            .into_iter()
            .map(|(key, v)| (key.encode_utf16().collect(), v))
            .collect(),
    )
}
fn result(value: std::result::Result<Value, template::Error>) -> NativeJson {
    NativeJson(match value {
        Ok(value) => object(vec![("value", value)]),
        Err(error) => object(vec![(
            "error",
            object(vec![
                ("description", Value::String(error.description)),
                (
                    "line",
                    error
                        .line
                        .map_or(Value::Null, |line| Value::Number(line as f64)),
                ),
                (
                    "column",
                    error
                        .column
                        .map_or(Value::Null, |column| Value::Number(column as f64)),
                ),
            ]),
        )]),
    })
}
#[napi]
pub fn template_partial_names(source: Utf16String) -> NativeJson {
    result(
        template::partial_names(&source)
            .map(|names| Value::Array(names.into_iter().map(Value::String).collect())),
    )
}
#[napi]
pub fn template_expand(source: Utf16String, callback: Callback<'_>) -> Result<NativeJson> {
    let mut host = Host {
        callback,
        error: None,
    };
    let value = template::expand_with(&source, &mut host);
    if let Some(error) = host.error {
        return Err(error);
    }
    Ok(result(value.map(Value::String)))
}
#[napi(object)]
pub struct NativeRenderOptions {
    pub context: u32,
    pub escape_none: bool,
    pub validate: bool,
    pub yield_text: Option<Utf16String>,
    pub in_context: bool,
    pub stack: Vec<Utf16String>,
}
#[napi]
pub fn template_render(
    source: Utf16String,
    callback: Callback<'_>,
    options: NativeRenderOptions,
) -> Result<NativeJson> {
    let mut host = Host {
        callback,
        error: None,
    };
    let value = template::render(
        &source,
        options.context as usize,
        &mut host,
        template::RenderOptions {
            escape_none: options.escape_none,
            validate: options.validate,
            yield_text: options.yield_text.as_ref().map(|s| s.as_ref()),
            in_context: options.in_context,
            partial_stack: options.stack.into_iter().map(|s| s.to_vec()).collect(),
        },
    );
    if let Some(error) = host.error {
        return Err(error);
    }
    Ok(result(value.map(Value::String)))
}

impl toolcraft_design_rust::data::DataHost for Host<'_> {
    fn coerce(&mut self, handle: usize) -> std::result::Result<Option<Vec<u16>>, template::Error> {
        Ok(Some(self.call(1, handle, 0, &[], &[])?.text.to_vec()))
    }
}
#[napi]
pub fn template_render_data(
    source: Utf16String,
    snapshot: Buffer,
    callback: Callback<'_>,
    options: NativeRenderOptions,
) -> Result<NativeJson> {
    use toolcraft_design_rust::data;
    let mut host = Host {
        callback,
        error: None,
    };
    let value = (|| {
        let graph = data::decode(&snapshot)?;
        let mut env = data::DataEnvironment::new(&graph, &mut host)?;
        template::render(
            &source,
            0,
            &mut env,
            template::RenderOptions {
                escape_none: options.escape_none,
                validate: options.validate,
                yield_text: options.yield_text.as_ref().map(|s| s.as_ref()),
                in_context: false,
                partial_stack: vec![],
            },
        )
    })();
    if let Some(error) = host.error {
        return Err(error);
    }
    Ok(result(value.map(Value::String)))
}

#[napi]
pub fn dashboard_layout(
    width: f64,
    height: f64,
    border: f64,
    footer: f64,
    right: f64,
) -> Float64Array {
    Float64Array::new(
        toolcraft_design_rust::layout::geometry([width, height, border, footer, right]).to_vec(),
    )
}
