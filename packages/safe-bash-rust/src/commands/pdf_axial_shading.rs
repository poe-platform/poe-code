// Bounded exponential-function axial shading (PDF 32000-1 §8.7.4.3).
use super::{Objects, Value};

pub(super) struct Axial {
    pub coords: [f64; 4],
    domain: [f64; 2],
    pub extend: [bool; 2],
    pub bbox: Option<[f64; 4]>,
    functions: Vec<Function>,
    components: usize,
}
struct Function {
    domain: [f64; 2],
    range: Option<Vec<f64>>,
    c0: Vec<f64>,
    c1: Vec<f64>,
    n: f64,
}
fn numbers<'a>(objects: &mut Objects<'a>, value: &Value<'a>, count: usize) -> Option<Vec<f64>> {
    let Value::Array(values) = objects.resolve(value)? else {
        return None;
    };
    if values.len() != count {
        return None;
    }
    values
        .iter()
        .map(|v| {
            let n = objects.resolve(v)?.number()?;
            n.is_finite().then_some(n)
        })
        .collect()
}
impl Axial {
    pub(super) fn read<'a>(objects: &mut Objects<'a>, value: &Value<'a>) -> Option<Self> {
        let dict = objects.resolve(value)?;
        if objects.resolve(dict.get(b"ShadingType")?)?.number()? != 2. {
            return None;
        }
        let components = match objects.resolve(dict.get(b"ColorSpace")?)?.word()? {
            b"/DeviceGray" => 1,
            b"/DeviceRGB" => 3,
            b"/DeviceCMYK" => 4,
            _ => return None,
        };
        let coords: [f64; 4] = numbers(objects, dict.get(b"Coords")?, 4)?.try_into().ok()?;
        let length = (coords[2] - coords[0]).hypot(coords[3] - coords[1]);
        if !length.is_finite() || length == 0. {
            return None;
        }
        let domain: [f64; 2] = match dict.get(b"Domain") {
            Some(v) => numbers(objects, v, 2)?.try_into().ok()?,
            None => [0., 1.],
        };
        if domain[0] > domain[1] {
            return None;
        }
        let extend = match dict.get(b"Extend") {
            None => [false; 2],
            Some(v) => {
                let Value::Array(a) = objects.resolve(v)? else {
                    return None;
                };
                if a.len() != 2 {
                    return None;
                }
                let mut out = [false; 2];
                for (i, v) in a.iter().enumerate() {
                    out[i] = match objects.resolve(v)?.word()? {
                        b"true" => true,
                        b"false" => false,
                        _ => return None,
                    };
                }
                out
            }
        };
        let bbox = match dict.get(b"BBox") {
            None => None,
            Some(v) => {
                let b: [f64; 4] = numbers(objects, v, 4)?.try_into().ok()?;
                if b[0] > b[2] || b[1] > b[3] {
                    return None;
                }
                Some(b)
            }
        };
        let value = objects.resolve(dict.get(b"Function")?)?;
        let (values, outputs) = match value {
            Value::Array(a) if a.len() == components => (a, 1),
            Value::Dict(_) => (vec![value], components),
            _ => return None,
        };
        let mut functions = Vec::new();
        for value in values {
            let f = objects.resolve(&value)?;
            if objects.resolve(f.get(b"FunctionType")?)?.number()? != 2. {
                return None;
            }
            let domain: [f64; 2] = numbers(objects, f.get(b"Domain")?, 2)?.try_into().ok()?;
            if domain[0] >= domain[1] {
                return None;
            }
            let n = objects.resolve(f.get(b"N")?)?.number()?;
            if !n.is_finite() || domain[0] < 0. || (domain[0] == 0. && n < 0.) {
                return None;
            }
            let c0 = match f.get(b"C0") {
                Some(v) => numbers(objects, v, outputs)?,
                None if outputs == 1 => vec![0.],
                _ => return None,
            };
            let c1 = match f.get(b"C1") {
                Some(v) => numbers(objects, v, outputs)?,
                None if outputs == 1 => vec![1.],
                _ => return None,
            };
            let range = match f.get(b"Range") {
                Some(v) => {
                    let r = numbers(objects, v, outputs * 2)?;
                    if r.as_chunks::<2>().0.iter().any(|p| p[0] > p[1]) {
                        return None;
                    }
                    Some(r)
                }
                None => None,
            };
            functions.push(Function {
                domain,
                range,
                c0,
                c1,
                n,
            });
        }
        Some(Self {
            coords,
            domain,
            extend,
            bbox,
            functions,
            components,
        })
    }

    pub(super) fn color(&self, t: f64) -> Option<[u8; 3]> {
        let input = self.domain[0] + t * (self.domain[1] - self.domain[0]);
        let mut values = [0.; 4];
        let mut index = 0;
        for f in &self.functions {
            let power = input.clamp(f.domain[0], f.domain[1]).powf(f.n);
            for (i, (&a, &b)) in f.c0.iter().zip(&f.c1).enumerate() {
                let mut value = a + power * (b - a);
                if !value.is_finite() {
                    return None;
                }
                if let Some(range) = &f.range {
                    value = value.clamp(range[2 * i], range[2 * i + 1]);
                }
                values[index] = value.clamp(0., 1.);
                index += 1;
            }
        }
        let rgb = match self.components {
            1 => [values[0]; 3],
            3 => [values[0], values[1], values[2]],
            _ => [0, 1, 2].map(|i| 1. - (values[i] + values[3]).min(1.)),
        };
        Some(rgb.map(|c| (c * 255.).round() as u8))
    }
}
