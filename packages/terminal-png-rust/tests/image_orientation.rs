use mcp_protocol_rust::cooperate::block_on;
use terminal_png_rust::image::orient_async;

#[test]
fn all_eight_orientations_preserve_asymmetric_pixels_and_budget_the_live_buffers() {
    let original: Vec<_> = (0..6).map(|v| [v, v, v, 255]).collect();
    // Independent row-major expectations for a 3x2 labeled raster:
    // A B C / D E F. EXIF 5 and 7 reflect across the two diagonals.
    for (orientation, order) in [
        (1, [0, 1, 2, 3, 4, 5]),
        (2, [2, 1, 0, 5, 4, 3]),
        (3, [5, 4, 3, 2, 1, 0]),
        (4, [3, 4, 5, 0, 1, 2]),
        (5, [0, 3, 1, 4, 2, 5]),
        (6, [3, 0, 4, 1, 5, 2]),
        (7, [5, 2, 4, 1, 3, 0]),
        (8, [2, 5, 1, 4, 0, 3]),
    ] {
        let cost = if orientation >= 5 { 48 } else { 24 };
        let mut pixels = original.clone();
        if orientation != 1 {
            assert_eq!(
                block_on(orient_async(3, 2, &mut pixels, orientation, cost - 1)).unwrap_err(),
                "image exceeds memory budget"
            );
            assert_eq!(pixels, original, "failed admission changed the input");
        }
        let size = block_on(orient_async(3, 2, &mut pixels, orientation, cost)).unwrap();
        assert_eq!(size, if orientation >= 5 { (2, 3) } else { (3, 2) });
        assert_eq!(pixels, order.map(|i| original[i]));
    }
    for orientation in 1..=8 {
        let mut empty = Vec::new();
        assert!(block_on(orient_async(0, 2, &mut empty, orientation, 0)).is_ok());
    }
}

#[test]
fn rectangular_orientation_yields_inside_the_transform_and_can_be_cancelled() {
    use std::{
        future::Future,
        pin::pin,
        task::{Context, Poll, Waker},
    };
    let original: Vec<_> = (0..256 * 128)
        .map(|i| [(i % 251) as u8, (i % 247) as u8, 0, 255])
        .collect();
    let mut pixels = original.clone();
    let mut cx = Context::from_waker(Waker::noop());
    {
        let mut pending = pin!(orient_async(256, 128, &mut pixels, 7, original.len() * 8));
        for _ in 0..4 {
            assert!(pending.as_mut().poll(&mut cx).is_pending());
        }
    }
    assert_eq!(
        pixels, original,
        "cancelled replacement must not publish partial pixels"
    );
    let mut complete = pin!(orient_async(256, 128, &mut pixels, 7, original.len() * 8));
    let mut yields = 0;
    loop {
        match complete.as_mut().poll(&mut cx) {
            Poll::Pending => yields += 1,
            Poll::Ready(size) => {
                assert_eq!(size.unwrap(), (128, 256));
                break;
            }
        }
    }
    assert_eq!(yields, 8, "the transform must yield every 4096 pixels");
}
