use super::{Objects, Value};

pub(in super::super) struct SoftMask {
    pub luminosity: bool,
    pub backdrop: [f64; 3],
}
impl SoftMask {
    pub(super) fn read<'a>(objects: &mut Objects<'a>, value: &Value<'a>) -> Option<Self> {
        let luminosity = match objects.resolve(value.get(b"S")?)?.word()? {
            b"/Alpha" => false,
            b"/Luminosity" => true,
            _ => return None,
        };
        // A non-identity transfer function needs a PDF function evaluator.
        if let Some(tr) = value.get(b"TR")
            && objects.resolve(tr)?.word()? != b"/Identity"
        {
            return None;
        }
        let mut backdrop = [0.; 3];
        if let Some(bc) = value.get(b"BC") {
            let Value::Array(values) = objects.resolve(bc)? else {
                return None;
            };
            if values.len() != 3 {
                return None;
            }
            for (out, v) in backdrop.iter_mut().zip(values) {
                *out = objects.resolve(&v)?.number()?;
                if !out.is_finite() || !(0. ..=1.).contains(out) {
                    return None;
                }
            }
        }
        Some(Self {
            luminosity,
            backdrop,
        })
    }
}
