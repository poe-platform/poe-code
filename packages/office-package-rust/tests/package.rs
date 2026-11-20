use office_package_rust::{Package, Part};

#[test]
fn packages_are_editable_before_serialization() {
    let mut package = Package {
        parts: vec![Part::new("word/document.xml", b"<document/>".to_vec())],
    };
    package
        .parts
        .push(Part::new("custom.xml", b"<custom/>".to_vec()));
    let bytes = package.write().unwrap();
    assert_eq!(&bytes[..4], b"PK\x03\x04");
    assert_eq!(&bytes[bytes.len() - 22..bytes.len() - 18], b"PK\x05\x06");
    assert_eq!(
        u16::from_le_bytes(
            bytes[bytes.len() - 12..bytes.len() - 10]
                .try_into()
                .unwrap()
        ),
        2
    );
    assert!(bytes.windows(10).any(|s| s == b"custom.xml"));
}

#[test]
fn ambiguous_and_escaping_part_names_are_rejected() {
    for names in [
        vec!["../outside"],
        vec!["/absolute"],
        vec!["same", "same"],
        vec!["empty//part"],
        vec!["./alias"],
        vec!["..\\outside"],
        vec!["bad\0name"],
    ] {
        let package = Package {
            parts: names
                .into_iter()
                .map(|name| Part::new(name, vec![]))
                .collect(),
        };
        assert!(package.write().is_err());
    }
}

fn poll_with_yield_count<F: std::future::Future>(future: F) -> (F::Output, usize) {
    use std::task::{Context, Poll, Waker};
    let mut future = std::pin::pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    let mut yields = 0;
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(result) => return (result, yields),
            Poll::Pending => yields += 1,
        }
    }
}

#[test]
fn async_zip_matches_sync_and_yields_while_processing_large_parts() {
    let package = Package {
        parts: vec![
            Part::new("checksum.txt", b"123456789".to_vec()),
            Part::new("word/media/image.bin", vec![0x5a; 128 * 1024]),
        ],
    };
    let (result, yields) = poll_with_yield_count(package.write_async());
    let bytes = result.unwrap();
    assert_eq!(bytes, package.write().unwrap());
    // The first stored entry uses the standard CRC-32 check vector.
    assert_eq!(&bytes[14..18], &0xcbf4_3926u32.to_le_bytes());
    assert!(
        yields >= 32,
        "large entry monopolized its caller: {yields} yields"
    );
}

#[test]
fn async_zip_yields_across_many_parts_and_preserves_validation() {
    let mut package = Package {
        parts: (0..256)
            .map(|index| Part::new(format!("parts/{index}.xml"), vec![]))
            .collect(),
    };
    let (result, yields) = poll_with_yield_count(package.write_async());
    assert_eq!(result.unwrap(), package.write().unwrap());
    assert!(yields >= 256, "part loop did not cooperate");
    package.parts.push(Part::new("../escape", vec![]));
    let (result, _) = poll_with_yield_count(package.write_async());
    assert_eq!(
        result.unwrap_err(),
        "Invalid or duplicate Office package part name"
    );
}
