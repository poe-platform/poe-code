//! Responsive explorer geometry, evaluated in one native batch.
use crate::feedback::Host;

pub struct Layout {
    pub mode: &'static str,
    pub header: [f64; 4],
    pub list: [f64; 4],
    pub detail: [f64; 4],
    pub footer: [f64; 4],
}

pub fn compute<E>(
    cols: f64,
    rows: f64,
    mut option: impl FnMut(&'static str, &'static str) -> Result<bool, E>,
) -> Result<Layout, E> {
    let normalize = |value: f64| {
        if value.is_finite() {
            value.floor().max(0.)
        } else {
            0.
        }
    };
    let cols = normalize(cols);
    let rows = normalize(rows);
    let mode = if cols < 60. || rows < 8. {
        "too-narrow"
    } else if cols < 80. {
        "narrow-list-only"
    } else if cols < 100. {
        "narrow-vertical"
    } else if cols < 120. {
        "medium"
    } else {
        "wide"
    };
    let footer_height = if rows > 0. { rows.min(1.) } else { 0. };
    let header_height = (rows - footer_height).clamp(0., 3.);
    let height = (rows - header_height - footer_height).max(0.);
    let mut layout = Layout {
        mode,
        header: [0., 0., cols, header_height],
        list: [0., header_height, cols, height],
        detail: [cols, header_height, 0., height],
        footer: [0., header_height + height, cols, footer_height],
    };
    if mode == "too-narrow" {
        layout.detail = [0., header_height + height, 0., 0.];
    } else if mode == "narrow-list-only" {
        if option("focused", "detail")? {
            layout.list[2] = 0.;
            layout.detail = [0., header_height, cols, height];
        }
    } else if !option("detailHidden", "true")? {
        if mode == "narrow-vertical" {
            let list_height = (height / 2.).ceil();
            layout.list[3] = list_height;
            layout.detail = [0., header_height + list_height, cols, height - list_height];
        } else {
            let available = (cols - 1.).max(0.);
            let list_width = if mode == "wide" {
                (available * 5. / 12.).floor()
            } else {
                (available * 2. / 5.).floor()
            };
            layout.list[2] = list_width;
            layout.detail = [
                list_width + 1.,
                header_height,
                available - list_width,
                height,
            ];
        }
    }
    Ok(layout)
}

pub fn body<H: Host>(host: &mut H, rect: H::Value) -> Result<H::Value, H::Error> {
    let result = host.call("object", vec![])?;
    for (key, inset) in [("x", 2.), ("y", 1.), ("width", 4.), ("height", 2.)] {
        let value = host.get(rect, key)?;
        let inset = host.number(inset)?;
        let value = if key == "x" || key == "y" {
            host.call("add", vec![value, inset])?
        } else {
            let value = host.call("subtract", vec![value, inset])?;
            let zero = host.number(0.)?;
            host.call("max", vec![zero, value])?
        };
        let key = host.literal(key)?;
        host.call("assign", vec![result, key, value])?;
    }
    Ok(result)
}
