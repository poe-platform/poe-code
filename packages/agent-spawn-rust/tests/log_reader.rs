use agent_spawn_rust::log_reader::{DecodedRecord, LogReader, Record};
use mcp_protocol_rust::json::{self, Limits, Value};
fn u(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
#[test]
fn line_locations_count_blank_lines_and_split_crlf_across_chunks() {
    let mut reader = LogReader::default();
    assert_eq!(
        reader.push(&u("\n \r\n\u{feff}one \r")),
        vec![Record {
            line_number: 3,
            text: u("one"),
        }]
    );
    assert_eq!(
        reader.push(&u("\ntwo\rthree\n\nlast")),
        vec![
            Record {
                line_number: 4,
                text: u("two"),
            },
            Record {
                line_number: 5,
                text: u("three"),
            }
        ]
    );
    assert_eq!(
        reader.end(),
        Some(Record {
            line_number: 7,
            text: u("last")
        })
    );
    assert_eq!(reader.end(), None);
    assert!(reader.push(&u("ignored\n")).is_empty());
}
#[test]
fn ecmascript_trimming_preserves_surrogates_and_non_whitespace() {
    let mut reader = LogReader::default();
    assert_eq!(
        reader.push(&[0x00a0, 0xd800, 0x0085, 0x202f, 10]),
        vec![Record {
            line_number: 1,
            text: vec![0xd800, 0x0085],
        }]
    );
    assert!(reader.push(&u("\u{3000}\t")).is_empty());
    assert_eq!(reader.end(), None);
}
#[test]
fn consumed_large_record_does_not_pin_native_buffer_capacity() {
    let mut reader = LogReader::default();
    let mut input = vec![65; 1024 * 1024];
    input.extend([10, 66]);
    assert_eq!(reader.push(&input)[0].text.len(), 1024 * 1024);
    assert!(reader.retained_capacity() < 4096);
    assert_eq!(reader.end().unwrap().text, vec![66]);
    assert_eq!(reader.retained_capacity(), 0);
}
#[test]
fn portable_decode_prioritizes_direct_updates_and_maps_legacy_records() {
    let record = |text: &str| Record {
        line_number: 1,
        text: u(text),
    };
    let source = r#"{"sessionUpdate":"custom","event":"reasoning","text":"direct wins"}"#;
    assert_eq!(
        record(source).decode(Default::default()).unwrap(),
        DecodedRecord::Updates(vec![
            json::parse(source.as_bytes(), Default::default()).unwrap()
        ])
    );
    assert_eq!(record(r#"{"event":"agent_message","text":"hello"}"#).decode(Default::default()).unwrap(),
        DecodedRecord::Updates(vec![json::parse(br#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}"#, Default::default()).unwrap()]));
    assert_eq!(
        record(r#"{"event":"future"}"#)
            .decode(Default::default())
            .unwrap(),
        DecodedRecord::Updates(vec![])
    );
    for text in ["null", "[]", "true", r#"{"sessionUpdate":0}"#] {
        assert_eq!(
            record(text).decode(Default::default()).unwrap(),
            DecodedRecord::Unknown
        );
    }
}
#[test]
fn portable_decode_keeps_opaque_fields_surrogates_and_explicit_parser_limits() {
    let record = Record {
        line_number: 3,
        text: u(
            r#"{"sessionUpdate":"custom","raw":"\ud800","input":{"__proto__":1},"number":1e400}"#,
        ),
    };
    let DecodedRecord::Updates(updates) = record.decode(Default::default()).unwrap() else {
        panic!("missing update")
    };
    assert_eq!(updates[0].get("raw"), Some(&Value::String(vec![0xd800])));
    assert_eq!(
        updates[0].get("number"),
        Some(&Value::Number(f64::INFINITY))
    );
    assert_eq!(
        updates[0].get("input").unwrap().get("__proto__"),
        Some(&Value::Number(1.0))
    );
    assert_eq!(
        record
            .decode(Limits {
                max_bytes: 2,
                ..Default::default()
            })
            .unwrap_err()
            .kind,
        json::ErrorKind::ByteLimit
    );
    assert!(
        Record {
            line_number: 4,
            text: u("not JSON")
        }
        .decode(Default::default())
        .is_err()
    );
}
