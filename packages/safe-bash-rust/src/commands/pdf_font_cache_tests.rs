use super::super::super::{Location, Objects, Value};
use super::{Rc, Resources};
use std::collections::BTreeMap;

const FONT: &[u8] = include_bytes!("../../../pdf-ast-rust/src/fonts/LiberationSans-Regular.ttf");

fn fixture(last: usize) -> (Vec<u8>, Vec<usize>) {
    let cmap=b"begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0001> <0041> endbfchar endcmap";
    let font=b"<< /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [2 0 R] /ToUnicode 4 0 R >>";
    let stream = |data: &[u8]| {
        [
            format!("<< /Length {} >>\nstream\n", data.len()).as_bytes(),
            data,
            b"\nendstream",
        ]
        .concat()
    };
    let bodies = vec![
        font.to_vec(),
        format!("<< /Subtype /CIDFontType2 /FontDescriptor 3 0 R /W [0 {last} 600] >>")
            .into_bytes(),
        b"<< /FontFile2 5 0 R >>".to_vec(),
        stream(cmap),
        stream(FONT),
        font.to_vec(),
        font.to_vec(),
    ];
    let mut bytes = Vec::new();
    let mut offsets = Vec::new();
    for (i, body) in bodies.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.extend(format!("{} 0 obj\n", i + 1).bytes());
        bytes.extend(body);
        bytes.extend(b"\nendobj\n");
    }
    (bytes, offsets)
}
fn resources(entries: &[(&str, usize)]) -> Value<'static> {
    Value::Dict(vec![(
        b"Font".as_slice().into(),
        Value::Dict(
            entries
                .iter()
                .map(|(name, id)| (name.as_bytes().to_vec().into(), Value::Ref((*id, 0))))
                .collect(),
        ),
    )])
}
fn objects<'a>(bytes: &'a [u8], offsets: &[usize]) -> Objects<'a> {
    let mut objects = Objects::new(bytes);
    for (i, &offset) in offsets.iter().enumerate() {
        objects.xref.insert((i + 1, 0), (Location::File(offset), 0));
    }
    objects
}

#[test]
fn cache_reuses_indirect_identity_across_aliases_but_keeps_distinct_and_direct_fonts_separate() {
    let (bytes, offsets) = fixture(1);
    let mut objects = objects(&bytes, &offsets);
    let mut cache = BTreeMap::new();
    let mut first = Resources::default();
    first
        .load(
            &mut objects,
            &resources(&[("F1", 1), ("Alias", 1)]),
            &mut cache,
        )
        .unwrap();
    assert!(Rc::ptr_eq(
        &first.fonts[b"F1".as_slice()],
        &first.fonts[b"Alias".as_slice()]
    ));
    let remaining = objects.remaining_bytes;
    let mut next = Resources::default();
    next.load(
        &mut objects,
        &resources(&[("DifferentAlias", 1)]),
        &mut cache,
    )
    .unwrap();
    assert_eq!(
        objects.remaining_bytes, remaining,
        "cache hit decoded or charged a retained font twice"
    );
    assert!(Rc::ptr_eq(
        &first.fonts[b"F1".as_slice()],
        &next.fonts[b"DifferentAlias".as_slice()]
    ));
    next.load(&mut objects, &resources(&[("F1", 6)]), &mut cache)
        .unwrap();
    assert!(!Rc::ptr_eq(
        &first.fonts[b"F1".as_slice()],
        &next.fonts[b"F1".as_slice()]
    ));
    assert_eq!(cache.len(), 2);
    let direct = objects.resolve(&Value::Ref((1, 0))).unwrap();
    let res = Value::Dict(vec![(
        b"Font".as_slice().into(),
        Value::Dict(vec![(b"F1".as_slice().into(), direct)]),
    )]);
    let remaining = objects.remaining_bytes;
    next.load(&mut objects, &res, &mut cache).unwrap();
    assert_eq!(
        cache.len(),
        2,
        "direct dictionaries have no shared object identity"
    );
    assert!(objects.remaining_bytes < remaining);
}

#[test]
fn expanded_cid_widths_and_distinct_cached_fonts_share_the_existing_byte_budget() {
    let (bytes, offsets) = fixture(65535);
    let mut source = objects(&bytes, &offsets);
    let mut cache = BTreeMap::new();
    source.remaining_bytes = FONT.len() + 128 * 1024;
    assert!(
        Resources::default()
            .load(&mut source, &resources(&[("F1", 1)]), &mut cache)
            .is_none()
    );
    assert!(
        cache.is_empty(),
        "rejected width expansion must not publish a cached font"
    );
    let (bytes, offsets) = fixture(4095);
    let mut source = objects(&bytes, &offsets);
    source.remaining_bytes = 2 * (FONT.len() + 4096 * 64) + 10000;
    for id in [1, 6] {
        Resources::default()
            .load(&mut source, &resources(&[("F1", id)]), &mut cache)
            .unwrap();
    }
    let remaining = source.remaining_bytes;
    Resources::default()
        .load(&mut source, &resources(&[("F1", 1)]), &mut cache)
        .unwrap();
    assert_eq!(source.remaining_bytes, remaining);
    assert!(
        Resources::default()
            .load(&mut source, &resources(&[("F1", 7)]), &mut cache)
            .is_none()
    );
    assert_eq!(cache.len(), 2);
}
