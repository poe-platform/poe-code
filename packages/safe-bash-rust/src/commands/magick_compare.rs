use super::{
    BuiltinOutcome, SafeBashFs, err_out, pixel_png, png_pixels::Raster, resolve_posix_path,
};

pub(super) struct Options {
    pub fuzz: f64,
    pub highlight: [u8; 4],
    pub lowlight: Option<[u8; 4]>,
    pub compose_src: bool,
    pub threshold: Option<f64>,
    pub density: u32,
}

fn number(n: f64) -> String {
    if !n.is_finite() {
        return "inf".into();
    }
    if n.abs() < 1e-9 {
        return "0".into();
    }
    let fixed = format!("{n:.6}");
    let s = fixed.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

pub(super) fn compare(
    images: [&Raster; 2],
    metric: &str,
    opts: &Options,
    dest: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let [a, b] = images;
    let (w, h) = (a.width.max(b.width), a.height.max(b.height));
    let Some(count) = w.checked_mul(h).filter(|&n| n <= fs.max_input_bytes() / 4) else {
        return err_out("compare: image exceeds memory budget\n", 2);
    };
    let alpha = a.alpha || b.alpha;
    let mut different = 0;
    let (mut abs, mut sq, mut max) = (0., 0., 0.0_f64);
    let mut sums = [0.; 5];
    let mut diff = (!dest.eq_ignore_ascii_case("null:")).then(|| Vec::with_capacity(count));
    for y in 0..h {
        for x in 0..w {
            let [pa, pb] = images.map(|im| {
                if x < im.width && y < im.height {
                    im.pixels[y * im.width + x]
                } else {
                    [0; 4]
                }
            });
            let [af, bf] = if alpha {
                [pa[3], pb[3]].map(|v| f64::from(v) / 255.)
            } else {
                [1.; 2]
            };
            let ds: [f64; 3] =
                std::array::from_fn(|i| (f64::from(pa[i]) * af - f64::from(pb[i]) * bf).abs());
            let da = if alpha {
                f64::from(pa[3].abs_diff(pb[3]))
            } else {
                0.
            };
            let peak = ds.into_iter().fold(da, f64::max);
            let differs =
                x >= a.width || x >= b.width || y >= a.height || y >= b.height || peak > opts.fuzz;
            different += usize::from(differs);
            if let Some(out) = &mut diff {
                out.push(if differs {
                    opts.highlight
                } else if opts.compose_src {
                    [0; 4]
                } else {
                    opts.lowlight.unwrap_or_else(|| {
                        let [r, g, b, _] =
                            pa.map(|v| (f64::from(v) * 0.3 + 255. * 0.7).round() as u8);
                        [r, g, b, 255]
                    })
                });
            }
            abs += ds[0] + ds[1] + ds[2] + da;
            sq += ds[0] * ds[0] + ds[1] * ds[1] + ds[2] * ds[2] + da * da;
            max = max.max(peak);
            let [la, lb] = [pa, pb].map(|[r, g, b, _]| {
                (0.299 * f64::from(r) + 0.587 * f64::from(g) + 0.114 * f64::from(b)) / 255.
            });
            for (s, v) in sums.iter_mut().zip([la, lb, la * la, lb * lb, la * lb]) {
                *s += v;
            }
        }
    }
    let n = count as f64;
    let div = n * if alpha { 4. } else { 3. } * 255.;
    let mse = sq / (div * 255.);
    let rmse = mse.sqrt();
    let [mu, nu, va, vb, cov] = sums.map(|s| s / n);
    let (va, vb, cov) = (
        (va - mu * mu).max(0.),
        (vb - nu * nu).max(0.),
        cov - mu * nu,
    );
    let ssim = (2. * mu * nu + 0.0001) * (2. * cov + 0.0009)
        / ((mu * mu + nu * nu + 0.0001) * (va + vb + 0.0009));
    let scaled = |v| format!("{} ({})", number(v * 65535.), number(v));
    let score = match metric {
        "ae" => different.to_string(),
        "mae" => scaled(abs / div),
        "mse" => scaled(mse),
        "pae" => scaled(max / 255.),
        "psnr" => number(10. * (1. / mse).log10()),
        "ssim" => number(ssim),
        "dssim" => number((1. - ssim) / 2.),
        "ncc" => number(if va == 0. && vb == 0. {
            1.
        } else if va * vb == 0. {
            cov
        } else {
            cov / (va * vb).sqrt()
        }),
        _ => scaled(rmse),
    };
    let mut stdout = String::new();
    if let Some(pixels) = diff {
        let data = pixel_png(w, h, super::PngEncoding::SplitDensity(opts.density), |x, y| pixels[y * w + x]);
        let path = dest.split_once(':').map_or(dest, |(_, p)| p);
        if path == "-" {
            stdout = crate::vfs::bytes_to_stream_string(&data);
        } else if let Err(e) = super::publish_magick_output(fs, &resolve_posix_path(cwd, path), &data) {
            return err_out(&format!("shell: line 1: {e}\n"), 1);
        }
    }
    BuiltinOutcome {
        stdout,
        stderr: format!("{score}\n"),
        exit_code: i32::from(opts.threshold.map_or(different > 0, |t| rmse > t)),
    }
}
