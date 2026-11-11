import type { RgbaImage } from "@poe-code/image-ast/portable";

export function htmlImageMap(image: Pick<RgbaImage, "width" | "height" | "properties">): string {
    // Match the HTML coder's entity ordering, including escaped angle-bracket entities.
    const title = (image.properties?.label ?? "-").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("&", "&amp;");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html>
<head>
<title>${title}</title>
</head>
<body style="text-align: center;">
<h1>-</h1><div>
<img usemap="#-" src="png:-" style="border: 0;" alt="Image map" />
<map id="-" name="-">
<area href="-" shape="rect" coords="0,0,${image.width - 1},${image.height - 1}" alt="" />
</map>
</div>
</body>
</html>
`;
}
