//! Declarative telemetry overlays and OTLP route policy; hosts own HTTP I/O.
use crate::{Planner, array, field, o, object, s, units};
use mcp_protocol_rust::json::Value;
impl Planner {
    pub fn telemetry_supported(&self, input: &str) -> bool {
        self.definition(input)
            .is_some_and(|definition| definition.metadata.get("otelCapture").is_some())
    }
    pub fn telemetry_plan(
        &self,
        input: &str,
        endpoint: &str,
        correlation: &str,
        content: bool,
    ) -> Option<Value> {
        let definition = self.definition(input)?;
        let capture = definition.metadata.get("otelCapture")?;
        let mut env = object(field(capture, "env")).unwrap_or_default().to_vec();
        for (key, value) in [
            ("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint.to_owned()),
            ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf".into()),
            (
                "OTEL_RESOURCE_ATTRIBUTES",
                format!("poe.code.spawn.id={correlation}"),
            ),
        ]
        .into_iter()
        .chain(content.then_some(()).into_iter().flat_map(|()| {
            [
                "OTEL_LOG_USER_PROMPTS",
                "OTEL_LOG_TOOL_CONTENT",
                "OTEL_LOG_TOOL_DETAILS",
            ]
            .map(|key| (key, "1".to_owned()))
        })) {
            let key: Vec<u16> = key.encode_utf16().collect();
            if let Some((_, prior)) = env.iter_mut().find(|(prior, _)| *prior == key) {
                *prior = s(&value);
            } else {
                env.push((key, s(&value)));
            }
        }
        let args = self
            .registry
            .telemetry_arguments(
                units(field(&definition.metadata, "id")),
                &endpoint.encode_utf16().collect::<Vec<_>>(),
                content,
            )
            .map(|args| args.into_iter().map(Value::String).collect())
            .unwrap_or_else(|| array(field(capture, "args")).to_vec());
        Some(o(vec![
            ("env", Value::Object(env)),
            ("args", Value::Array(args)),
        ]))
    }
}
pub fn signal(path: &[u16]) -> Option<&'static str> {
    [
        ("/v1/traces", "traces"),
        ("/v1/logs", "logs"),
        ("/v1/metrics", "metrics"),
    ]
    .into_iter()
    .find(|(suffix, _)| {
        path.len() >= suffix.len()
            && path[path.len() - suffix.len()..]
                .iter()
                .zip(suffix.bytes())
                .all(|(unit, byte)| *unit == u16::from(byte))
    })
    .map(|(_, signal)| signal)
}
