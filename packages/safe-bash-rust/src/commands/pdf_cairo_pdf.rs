use super::{Copy, PageOutput, PageSource, Value, set};

#[derive(Clone, Copy, Default)]
pub(in super::super::super) struct CairoPdfLayout {
    pub paper: Option<[f64; 2]>,
    pub crop: Option<[f64; 4]>,
}

impl PageOutput {
    pub(in super::super::super) fn cairo(
        source: &mut PageSource<'_>,
        pages: impl Iterator<Item = usize> + Clone,
        layout: CairoPdfLayout,
        limit: usize,
    ) -> Option<Vec<u8>> {
        let mut output = Self::new(limit);
        output.copy_pages(source, pages, false, |_| None, None, Some(layout))?;
        output.finish()
    }
}

impl<'a> Copy<'_, 'a> {
    pub(super) fn cairo_page(
        &mut self,
        entries: &mut super::super::Dict<'a>,
        media: [f64; 4],
        rotation: f64,
        layout: CairoPdfLayout,
    ) -> Option<()> {
        if layout.paper.is_none() && layout.crop.is_none() {
            return Some(());
        }
        let [ox, oy, right, top] = media;
        let (width, height) = ((right - ox).abs(), (top - oy).abs());
        let [page_w, page_h] = layout.paper.map_or([width, height], |[w, h]| {
            if width > height { [h, w] } else { [w, h] }
        });
        let side = rotation == 90. || rotation == 270.;
        let (display_w, display_h) = if side {
            (height, width)
        } else {
            (width, height)
        };
        let [cx, cy, cw, ch] = layout.crop.unwrap_or([0.; 4]);
        let cw = if cw > 0. {
            cw
        } else {
            (display_w - cx).max(1.)
        };
        let ch = if ch > 0. {
            ch
        } else {
            (display_h - cy).max(1.)
        };
        let (w, h) = if side { (ch, cw) } else { (cw, ch) };
        let (x, y) = match rotation {
            90. => (cy, cx),
            180. => (width - cx - w, cy),
            270. => (width - cy - w, height - cx - h),
            _ => (cx, height - cy - h),
        };
        let (x, y) = (x + ox, y + oy);
        let scale = 1_f64.min(page_w / w).min(page_h / h);
        let (tx, ty) = (
            (page_w - w * scale) / 2. - x * scale,
            (page_h - h * scale) / 2. - y * scale,
        );
        if ![page_w, page_h, x, y, w, h, scale, tx, ty]
            .iter()
            .all(|n| n.is_finite())
        {
            return None;
        }
        let mut contents = Vec::new();
        if let Some(value) = entries
            .iter()
            .find(|(k, _)| k.as_ref() == b"Contents")
            .map(|(_, v)| v)
        {
            match self.objects.resolve(value) {
                Some(Value::Array(a)) => contents.extend(a),
                _ => contents.push(value.clone()),
            }
        }
        let mut stream = |bytes: &[u8]| -> Option<Value<'a>> {
            let mut body = format!("<< /Length {} >>\nstream\n", bytes.len()).into_bytes();
            body.extend_from_slice(bytes);
            body.extend_from_slice(b"\nendstream");
            self.output.remaining = self.output.remaining.checked_sub(body.len())?;
            self.output.bodies.push(body);
            // Already allocated in the output graph, so the source copier must not remap it.
            Some(Value::Word(
                format!("{} 0 R", self.output.bodies.len())
                    .into_bytes()
                    .into(),
            ))
        };
        let prefix = format!("q\n{scale} 0 0 {scale} {tx} {ty} cm\n{x} {y} {w} {h} re W n\n");
        contents.insert(0, stream(prefix.as_bytes())?);
        contents.push(stream(b"\nQ\n")?);
        set(entries, b"Contents", Value::Array(contents));
        let rect = Value::Array(
            [0., 0., page_w, page_h]
                .map(|n| Value::Word(n.to_string().into_bytes().into()))
                .into(),
        );
        set(entries, b"MediaBox", rect.clone());
        set(entries, b"CropBox", rect);
        Some(())
    }
}
