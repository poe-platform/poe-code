use super::{content, object, schema, string, string_matches};
use mcp_protocol_rust::{
    json::{self, Value},
    jsonrpc::{self, RpcError},
};
use toolcraft_schema_rust::CompiledSchema;

pub struct ToolOutput {
    pub(crate) schema: Option<Value>,
    pub(crate) validator: Option<CompiledSchema>,
}

#[derive(Debug)]
pub enum ResultError {
    Content(String),
    Rpc(RpcError),
}

fn rpc(message: &str) -> ResultError {
    ResultError::Rpc(RpcError {
        code: jsonrpc::INTERNAL_ERROR,
        message: message.into(),
        data: None,
    })
}

impl ToolOutput {
    pub fn normalize(&self, returned: Option<Value>, modern: bool) -> Result<Value, ResultError> {
        let Some(output_schema) = &self.schema else {
            return content::normalize_result(returned, modern).map_err(ResultError::Content);
        };
        let compatible = modern || string_matches(output_schema.get("type"), "object");
        let explicit = returned
            .as_ref()
            .is_some_and(|value| matches!(value.get("content"), Some(Value::Array(_))));
        let normalized = if explicit {
            Some(
                content::normalize_result(returned.clone(), modern || !compatible)
                    .map_err(|message| rpc(&message))?,
            )
        } else {
            None
        };
        if normalized
            .as_ref()
            .is_some_and(|value| value.get("isError") == Some(&Value::Bool(true)))
        {
            return Ok(normalized.expect("explicit error result"));
        }
        let structured = if let Some(normalized) = &normalized {
            normalized.get("structuredContent").cloned()
        } else {
            returned.clone()
        };
        let structured = structured
            .filter(|value| {
                value.is_json_value()
                    && (modern || !compatible || matches!(value, Value::Object(_)))
            })
            .ok_or_else(|| {
                rpc(if modern || !compatible {
                    "Structured tool result must be JSON"
                } else {
                    "Structured tool result must be a JSON object"
                })
            })?;
        let mut fields = match normalized {
            Some(Value::Object(fields)) => fields,
            None => Vec::new(),
            _ => unreachable!("explicit result object"),
        };
        let has_content = fields.iter().any(|(name, value)| {
            name.iter().copied().eq("content".encode_utf16())
                && matches!(value, Value::Array(content) if !content.is_empty())
        });
        if !has_content {
            super::put(
                &mut fields,
                "content",
                Value::Array(vec![object([
                    ("type", string("text")),
                    ("text", string(&json::stringify(&structured))),
                ])]),
            );
        }
        super::put(&mut fields, "structuredContent", structured.clone());
        if compatible {
            let issues = self
                .validator
                .as_ref()
                .expect("compiled output schema")
                .validate(&structured, Default::default())
                .map_err(|message| rpc(&message))?;
            if !issues.is_empty() {
                return Err(ResultError::Rpc(schema::validation_error(
                    jsonrpc::INTERNAL_ERROR,
                    "Invalid structured tool result: ",
                    issues,
                )));
            }
        } else {
            fields.retain(|(name, _)| !name.iter().copied().eq("structuredContent".encode_utf16()));
            if let Some(Value::String(text)) = returned {
                super::put(
                    &mut fields,
                    "content",
                    Value::Array(vec![object([
                        ("type", string("text")),
                        ("text", Value::String(text)),
                    ])]),
                );
            }
        }
        Ok(Value::Object(fields))
    }
}
