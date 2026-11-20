//! Explicit layout inputs. All dimensions are PDF points; supplied font bytes
//! are the only font resources read when `fonts` is nonempty.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageBox {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
}
impl Default for PageBox {
    fn default() -> Self {
        Self {
            width: 595.28,
            height: 841.89,
            margin: 48.,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FontFamily {
    #[default]
    Sans,
    Mono,
    Serif,
}
#[derive(Clone, Debug)]
pub struct SuppliedFont {
    pub id: String,
    pub bytes: Vec<u8>,
}
#[derive(Clone, Debug, Default)]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Vec<String>,
}
#[derive(Clone, Debug)]
pub struct PdfLimits {
    pub font_bytes: usize,
    pub fonts: usize,
    pub glyphs: usize,
    pub pages: usize,
    pub objects: usize,
    pub images: usize,
    pub image_bytes: usize,
    pub image_pixels: usize,
    pub decoded_image_bytes: usize,
    pub layout_work: usize,
    pub output_bytes: usize,
}
impl Default for PdfLimits {
    fn default() -> Self {
        Self {
            font_bytes: usize::MAX,
            fonts: usize::MAX,
            glyphs: usize::MAX,
            pages: usize::MAX,
            objects: usize::MAX,
            images: usize::MAX,
            image_bytes: usize::MAX,
            image_pixels: usize::MAX,
            decoded_image_bytes: usize::MAX,
            layout_work: usize::MAX,
            output_bytes: usize::MAX,
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct PdfUsage {
    pub font_bytes: usize,
    pub fonts: usize,
    pub glyphs: usize,
    pub pages: usize,
    pub objects: usize,
    pub images: usize,
    pub image_bytes: usize,
    pub image_pixels: usize,
    pub decoded_image_bytes: usize,
    pub layout_work: usize,
    pub output_bytes: usize,
}
#[derive(Clone, Debug)]
pub struct PdfOutput {
    pub bytes: Vec<u8>,
    pub usage: PdfUsage,
}
#[derive(Clone, Debug)]
pub struct PdfOptions {
    pub page: PageBox,
    pub font_size: f64,
    pub line_height: f64,
    pub font_family: FontFamily,
    pub fonts: Vec<SuppliedFont>,
    pub metadata: PdfMetadata,
    pub limits: PdfLimits,
}
impl Default for PdfOptions {
    fn default() -> Self {
        Self {
            page: PageBox::default(),
            font_size: 12.,
            line_height: 1.65,
            font_family: FontFamily::Sans,
            fonts: Vec::new(),
            metadata: PdfMetadata::default(),
            limits: PdfLimits::default(),
        }
    }
}
pub(crate) fn charge(
    used: &mut usize,
    amount: usize,
    limit: usize,
    key: &str,
) -> Result<(), String> {
    if amount > limit.saturating_sub(*used) {
        return Err(format!("E_LIMIT: PDF {key} limit exceeded"));
    }
    *used = used
        .checked_add(amount)
        .ok_or_else(|| format!("E_LIMIT: PDF {key} limit exceeded"))?;
    Ok(())
}
impl PdfOptions {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let p = self.page;
        if !p.width.is_finite()
            || !p.height.is_finite()
            || !p.margin.is_finite()
            || p.margin < 0.
            || p.width <= 2. * p.margin
            || p.height <= 2. * p.margin
        {
            return Err("Invalid PDF page box".into());
        }
        if !self.font_size.is_finite() || self.font_size <= 0. || self.font_size > 144. {
            return Err("Invalid PDF font size".into());
        }
        if !self.line_height.is_finite() || !(1.0..=3.0).contains(&self.line_height) {
            return Err("Invalid PDF line-height multiplier".into());
        }
        if self.font_family == FontFamily::Serif && self.fonts.is_empty() {
            return Err("The serif family requires an explicit supplied font".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        for font in &self.fonts {
            if font.id.is_empty() || !ids.insert(&font.id) {
                return Err("Duplicate or empty supplied PDF font identity".into());
            }
        }
        Ok(())
    }
}
