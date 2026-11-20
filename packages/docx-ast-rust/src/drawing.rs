//! SVG pictures serialized directly from the shared vector scene.
use super::{Context, Writer, alignment};
use document_ast_rust::{
    Direction,
    vector::{Scene, svg::to_svg},
};
use std::fmt::Write;

impl Writer {
    pub(super) async fn drawing(&mut self, scene: &Scene, ctx: Context) -> Result<(), String> {
        let bytes = to_svg(scene).await?.into_bytes();
        let index = self.images.len() + 1;
        let target = format!("media/image-{index}.svg");
        self.images.push((format!("word/{target}"), bytes));
        let rel = self.relation("image", &target, false).await;
        let scale = (ctx.available_width.unwrap_or(468.) / scene.width)
            .min(648. / scene.height)
            .min(1.);
        let width = (scene.width * scale * 12700.).round().max(1.) as u64;
        let height = (scene.height * scale * 12700.).round().max(1.) as u64;
        self.image_id += 1;
        let id = self.image_id;
        self.body
            .push_str("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"160\"/>");
        if let Some(direction) = ctx.direction {
            write!(
                self.body,
                "<w:bidi w:val=\"{}\"/>",
                direction == Direction::Rtl
            )
            .unwrap();
        }
        if let Some(align) = ctx.align {
            write!(self.body, "<w:jc w:val=\"{}\"/>", alignment(align)).unwrap();
        }
        // Pandoc's SVG-only form: the base blip has no bitmap relationship;
        // Office's SVG extension owns the embedded SVG relationship instead.
        write!(self.body, r#"</w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{width}" cy="{height}"/><wp:docPr id="{id}" name="Vector drawing {id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Vector drawing {id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip><a:extLst><a:ext uri="{{28A0092B-C50C-407E-A947-70E740481C1C}}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext><a:ext uri="{{96DAC541-7B7A-43D3-8B79-37D633B846F1}}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{rel}"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width}" cy="{height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#).unwrap();
        Ok(())
    }
}
