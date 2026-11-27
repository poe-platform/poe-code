use super::{magick_composite, png_pixels::Raster};

pub(super) enum Primitive {
    Point([f64; 2]),
    Rectangle([f64; 4]),
}

pub(super) fn parse(spec: &str, limit: usize) -> Result<Vec<Primitive>, &'static str> {
    let mut tokens = spec
        .split(|c: char| c.is_ascii_whitespace() || c == ',' || c == ';')
        .filter(|token| !token.is_empty());
    let mut primitives = Vec::new();
    while let Some(command) = tokens.next() {
        let mut number = || {
            tokens
                .next()
                .and_then(|token| token.parse::<f64>().ok())
                .filter(|value| value.is_finite())
                .ok_or("non-conforming drawing primitive definition")
        };
        let primitive = match command {
            "point" => Primitive::Point([number()?, number()?]),
            "rectangle" => Primitive::Rectangle([number()?, number()?, number()?, number()?]),
            _ => return Err("non-conforming or unsupported drawing primitive definition"),
        };
        if primitives.len() >= limit / std::mem::size_of::<Primitive>() {
            return Err("drawing exceeds resource limits");
        }
        primitives.push(primitive);
    }
    Ok(primitives)
}

pub(super) fn draw(
    image: &mut Raster,
    primitives: &[Primitive],
    fill: [u8; 4],
    limit: usize,
) -> Result<(), &'static str> {
    let mut remaining = limit;
    for primitive in primitives {
        let [left, top, right, bottom] = match *primitive {
            Primitive::Point([x, y]) => {
                // ImageMagick selects the lower pixel at exact half ties.
                let (x, y) = ((x - 0.5).ceil(), (y - 0.5).ceil());
                [x, y, x, y]
            }
            Primitive::Rectangle([x0, y0, x1, y1]) => {
                [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]
            }
        };
        // Clip before iterating: even enormous off-canvas coordinates cost only
        // the number of affected image pixels, never the requested shape area.
        let x0 = left.floor().clamp(0., image.width as f64) as usize;
        let y0 = top.floor().clamp(0., image.height as f64) as usize;
        let x1 = (right.ceil() + 1.).clamp(0., image.width as f64) as usize;
        let y1 = (bottom.ceil() + 1.).clamp(0., image.height as f64) as usize;
        remaining = remaining
            .checked_sub((x1 - x0).saturating_mul(y1 - y0))
            .ok_or("drawing exceeds resource limits")?;
        for y in y0..y1 {
            for x in x0..x1 {
                let dx = (left - x as f64).max(x as f64 - right).max(0.);
                let dy = (top - y as f64).max(y as f64 - bottom).max(0.);
                // Inclusive rectangle edges have full coverage; exterior
                // subpixel coverage follows ImageMagick's squared distance fade.
                let coverage = (1. - dx.hypot(dy)).max(0.).powi(2);
                let mut source = fill;
                source[3] = (f64::from(fill[3]) * coverage).round() as u8;
                if source[3] == 0 {
                    continue;
                }
                let pixel = &mut image.pixels[y * image.width + x];
                if !image.alpha {
                    pixel[3] = 255;
                }
                *pixel = magick_composite::blend(source, *pixel, "over", 1., 1.);
                image.gray &= fill[0] == fill[1] && fill[1] == fill[2];
            }
        }
    }
    Ok(())
}
