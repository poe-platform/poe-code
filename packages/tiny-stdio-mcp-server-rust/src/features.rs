use super::{
    Action, DEFAULT_LEGACY_PROTOCOL_VERSION, Session, content, failure, handler_context, object,
    rpc_error, string_matches, uri_template::UriTemplate,
};
use mcp_protocol_rust::{
    formats::is_valid_uri,
    json::Value,
    jsonrpc::{self, RpcError},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistrationKind {
    Prompt,
    Resource,
    ResourceTemplate,
    Method,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeatureKind {
    Prompt { allow_resource_links: bool },
    Resource,
    Custom,
}
pub(crate) struct Registered {
    key: Vec<u16>,
    descriptor: Value,
    handler: u64,
    template: Option<UriTemplate>,
}
#[derive(Default)]
pub struct Features {
    prompts: Vec<Registered>,
    resources: Vec<Registered>,
    templates: Vec<Registered>,
    methods: Vec<Registered>,
}
impl Features {
    fn collection(&self, kind: RegistrationKind) -> &[Registered] {
        match kind {
            RegistrationKind::Prompt => &self.prompts,
            RegistrationKind::Resource => &self.resources,
            RegistrationKind::ResourceTemplate => &self.templates,
            RegistrationKind::Method => &self.methods,
        }
    }
    fn collection_mut(&mut self, kind: RegistrationKind) -> &mut Vec<Registered> {
        match kind {
            RegistrationKind::Prompt => &mut self.prompts,
            RegistrationKind::Resource => &mut self.resources,
            RegistrationKind::ResourceTemplate => &mut self.templates,
            RegistrationKind::Method => &mut self.methods,
        }
    }
    pub fn register(
        &mut self,
        kind: RegistrationKind,
        descriptor: Value,
        handler: u64,
    ) -> Result<Vec<u16>, String> {
        let (field, label) = match kind {
            RegistrationKind::Prompt => ("name", "Prompt"),
            RegistrationKind::Resource => ("uri", "Resource"),
            RegistrationKind::ResourceTemplate => ("uriTemplate", "Resource template"),
            RegistrationKind::Method => ("", "Method"),
        };
        let key = if kind == RegistrationKind::Method {
            &descriptor
        } else {
            descriptor
                .get(field)
                .ok_or_else(|| format!("{label} {field} required"))?
        };
        let Value::String(key) = key else {
            return Err(format!("{label} {field} required"));
        };
        let key = key.clone();
        if matches!(kind, RegistrationKind::Prompt | RegistrationKind::Method) && key.is_empty() {
            return Err(format!("{label} name required"));
        }
        if kind == RegistrationKind::Resource && !is_valid_uri(&key) {
            return Err(format!(
                "Invalid resource URI: {}",
                String::from_utf16_lossy(&key)
            ));
        }
        let template = if kind == RegistrationKind::ResourceTemplate {
            let template = UriTemplate::parse(&key)?;
            if !is_valid_uri(&template.expand(&object([]))?) {
                return Err(format!(
                    "Invalid resource URI template: {}",
                    String::from_utf16_lossy(&key)
                ));
            }
            Some(template)
        } else {
            None
        };
        let collection = self.collection_mut(kind);
        let existing = collection.iter().position(|entry| entry.key == key);
        if existing.is_some() && kind != RegistrationKind::Method {
            return Err(format!(
                "{label} already registered: {}",
                String::from_utf16_lossy(&key)
            ));
        }
        let registered = Registered {
            key: key.clone(),
            descriptor,
            handler,
            template,
        };
        if let Some(index) = existing {
            collection[index] = registered;
        } else {
            collection.push(registered);
        }
        Ok(key)
    }
    pub fn remove(&mut self, kind: RegistrationKind, key: &[u16]) -> Option<u64> {
        let collection = self.collection_mut(kind);
        let index = collection.iter().position(|entry| entry.key == key)?;
        Some(collection.remove(index).handler)
    }
    pub(crate) fn readable(&self, uri: &[u16]) -> Result<Option<&Registered>, String> {
        if let Some(resource) = self.resources.iter().find(|resource| resource.key == uri) {
            return Ok(Some(resource));
        }
        for resource in &self.templates {
            if resource
                .template
                .as_ref()
                .expect("registered template")
                .match_uri(uri)?
                .is_some()
            {
                return Ok(Some(resource));
            }
        }
        Ok(None)
    }
    pub fn dispatch(
        &self,
        session: &Session,
        method: &str,
        params: Option<Value>,
        modern: bool,
    ) -> Option<Action> {
        let list = match method {
            "prompts/list" => Some((RegistrationKind::Prompt, "prompts")),
            "resources/list" => Some((RegistrationKind::Resource, "resources")),
            "resources/templates/list" => {
                Some((RegistrationKind::ResourceTemplate, "resourceTemplates"))
            }
            _ => None,
        };
        if let Some((kind, field)) = list {
            return Some(Action::Reply(object([(
                field,
                Value::Array(
                    self.collection(kind)
                        .iter()
                        .map(|entry| entry.descriptor.clone())
                        .collect(),
                ),
            )])));
        }
        if method == "prompts/get" {
            let Some(Value::String(name)) = params.as_ref().and_then(|params| params.get("name"))
            else {
                return Some(failure(jsonrpc::INVALID_PARAMS, "Prompt name required"));
            };
            let Some(prompt) = self.prompts.iter().find(|prompt| &prompt.key == name) else {
                return Some(failure(
                    jsonrpc::INVALID_PARAMS,
                    &format!("Prompt not found: {}", String::from_utf16_lossy(name)),
                ));
            };
            let arguments = params
                .as_ref()
                .and_then(|params| params.get("arguments"))
                .cloned()
                .unwrap_or_else(|| object([]));
            let Value::Object(values) = &arguments else {
                return Some(failure(jsonrpc::INVALID_PARAMS, "Invalid prompt arguments"));
            };
            if values
                .iter()
                .any(|(_, value)| !matches!(value, Value::String(_)))
            {
                return Some(failure(jsonrpc::INVALID_PARAMS, "Invalid prompt arguments"));
            }
            if let Some(Value::Array(required)) = prompt.descriptor.get("arguments") {
                for argument in required {
                    if argument.get("required") == Some(&Value::Bool(true))
                        && !matches!(argument.get("name"), Some(Value::String(name)) if values.iter().any(|(key, _)| key == name))
                    {
                        return Some(failure(jsonrpc::INVALID_PARAMS, "Invalid prompt arguments"));
                    }
                }
            }
            return Some(Action::InvokeFeature {
                handler: prompt.handler,
                arguments: Some(arguments),
                context: handler_context(params.as_ref(), modern),
                kind: FeatureKind::Prompt {
                    allow_resource_links: modern
                        || session.protocol_version() == DEFAULT_LEGACY_PROTOCOL_VERSION,
                },
            });
        }
        if method == "resources/read" {
            let Some(Value::String(uri)) = params
                .as_ref()
                .and_then(|params| params.get("uri"))
                .filter(|uri| matches!(uri, Value::String(uri) if is_valid_uri(uri)))
            else {
                return Some(failure(jsonrpc::INVALID_PARAMS, "Resource URI required"));
            };
            let resource = match self.readable(uri) {
                Ok(Some(resource)) => resource,
                Ok(None) => {
                    return Some(failure(
                        if modern {
                            jsonrpc::INVALID_PARAMS
                        } else {
                            -32002
                        },
                        &format!("Resource not found: {}", String::from_utf16_lossy(uri)),
                    ));
                }
                Err(message) => return Some(failure(jsonrpc::INTERNAL_ERROR, &message)),
            };
            return Some(Action::InvokeFeature {
                handler: resource.handler,
                arguments: Some(Value::String(uri.clone())),
                context: handler_context(params.as_ref(), modern),
                kind: FeatureKind::Resource,
            });
        }
        self.methods
            .iter()
            .find(|entry| entry.key.iter().copied().eq(method.encode_utf16()))
            .map(|entry| Action::InvokeFeature {
                handler: entry.handler,
                arguments: params,
                context: object([]),
                kind: FeatureKind::Custom,
            })
    }
}

pub fn validate_result(
    kind: FeatureKind,
    result: Option<Value>,
) -> Result<Option<Value>, RpcError> {
    let valid = match kind {
        FeatureKind::Custom => true,
        FeatureKind::Resource => {
            matches!(&result, Some(Value::Object(_)))
                && matches!(result.as_ref().and_then(|result| result.get("contents")), Some(Value::Array(contents)) if contents.iter().all(content::is_resource_contents))
        }
        FeatureKind::Prompt {
            allow_resource_links,
        } => {
            matches!(&result, Some(Value::Object(_)))
                && result
                    .as_ref()
                    .and_then(|result| result.get("description"))
                    .is_none_or(|value| matches!(value, Value::String(_)))
                && matches!(result.as_ref().and_then(|result| result.get("messages")), Some(Value::Array(messages)) if messages.iter().all(|message| {
                    matches!(message, Value::Object(_)) && (string_matches(message.get("role"), "user") || string_matches(message.get("role"), "assistant"))
                        && message.get("content").is_some_and(|content| content::is_content_item(content) && (allow_resource_links || !string_matches(content.get("type"), "resource_link")))
                }))
        }
    };
    if valid {
        Ok(result)
    } else {
        Err(rpc_error(
            jsonrpc::INTERNAL_ERROR,
            if matches!(kind, FeatureKind::Prompt { .. }) {
                "Invalid prompt result"
            } else {
                "Invalid resource result"
            },
        ))
    }
}
