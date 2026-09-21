use mcp_protocol_rust::json::Value;
use poe_agent_rust::session::{ReadError, decode};
#[test]
fn independently_validates_session_roles_and_structured_tool_parts() {
    let valid = r#"{"version":1,"threadId":"t\ud800","model":"m","cwd":"/x","createdAt":"a","updatedAt":"b","messages":[{"role":"tool","content":[{"type":"text","text":"x"},{"type":"image","mimeType":"image/png","data":"AA=="},{"type":"error","code":"e","message":"bad","retriable":false}]}]}"#;
    assert!(decode(&valid.encode_utf16().collect::<Vec<_>>()).is_ok());
    let invalid = valid.replace("\"retriable\":false", "\"retriable\":0");
    assert!(matches!(
        decode(&invalid.encode_utf16().collect::<Vec<_>>()),
        Err(ReadError::Invalid)
    ));
    assert!(matches!(
        decode(&r#"{"version":2}"#.encode_utf16().collect::<Vec<_>>()),
        Err(ReadError::Unsupported(Some(Value::Number(2.0))))
    ));
    assert!(matches!(
        decode(&r#"[]"#.encode_utf16().collect::<Vec<_>>()),
        Err(ReadError::Unsupported(None))
    ));
    assert!(matches!(decode(&[123]), Err(ReadError::Syntax(_))));
}
