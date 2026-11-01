"""离线生成五种统一轮廓的宝箱. 在仓库根目录运行: python scripts/generate-chest-icons.py.

只写入指定的五张 PNG 和联排预览, 不依赖字体下载或业务数据.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "projects/mmorpg/assets/icons/chests"
PREVIEW = ROOT / "output/chest-icons-preview.png"
SIZE = 128
SCALE = 4  # 超采样后缩小, 让细描边和曲线在小尺寸下保持平滑.
INK = "#30261f"
PALETTES = {
    "wood": ("#b98547", "#74421f", "#d2a259", "#786142", "#ebcb88", "#554027"),
    "iron": ("#8d9ca8", "#465564", "#a9b7bf", "#3d4856", "#d2e2e8", "#293440"),
    "copper": ("#e2a16b", "#955035", "#efb679", "#a85c38", "#ffe0a3", "#6d3927"),
    "silver": ("#d9edf6", "#819caf", "#eefaff", "#91adbf", "#ffffff", "#506c80"),
    "gold": ("#ffdb73", "#c48a25", "#fff0a0", "#d49b30", "#fff9cb", "#8a591c"),
}


def rgb(color):
    return tuple(bytes.fromhex(color.lstrip("#")))


def points(coords):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in coords]


def curve(a, b, c, d, steps=24):
    """用三次贝塞尔采样共用的拱盖, 避免引入额外绘图库."""
    result = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        result.append((u**3*a[0] + 3*u*u*t*b[0] + 3*u*t*t*c[0] + t**3*d[0],
                       u**3*a[1] + 3*u*u*t*b[1] + 3*u*t*t*c[1] + t**3*d[1]))
    return result


def render(name, palette):
    light, dark, rim_light, rim_dark, shine, edge = palette
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE))
    draw = ImageDraw.Draw(image)

    def line(coords, color=INK, width=1):
        draw.line(points(coords), fill=color, width=round(width*SCALE), joint="curve")

    def polygon(coords, color, outline=INK, width=1.15):
        draw.polygon(points(coords), fill=color)
        if outline:
            line(coords + [coords[0]], outline, width)

    def ellipse(box, color, outline=None, width=1):
        draw.ellipse(tuple(round(n*SCALE) for n in box), fill=color,
                     outline=outline, width=round(width*SCALE))

    def gradient(coords, top, bottom):
        mask = Image.new("L", image.size)
        ImageDraw.Draw(mask).polygon(points(coords), fill=255)
        min_y = min(y for _, y in coords)
        max_y = max(y for _, y in coords)
        layer = Image.new("RGBA", image.size)
        ld = ImageDraw.Draw(layer)
        c1, c2 = rgb(top), rgb(bottom)
        for y in range(round(min_y*SCALE), round(max_y*SCALE)+1):
            t = (y/SCALE-min_y) / max(1, max_y-min_y)
            color = tuple(round(a+(b-a)*t) for a, b in zip(c1, c2)) + (255,)
            ld.line((0, y, SIZE*SCALE, y), fill=color)
        image.paste(layer, (0, 0), mask)
        line(coords + [coords[0]], INK, 1.4)

    # 三分之四视角下的闭合箱体, 五个材质仅替换配色, 不改变轮廓.
    ellipse((18, 108, 115, 119), (15, 30, 43, 52))
    ellipse((28, 110, 107, 116), (15, 30, 43, 35))
    side = [(87, 61), (113, 50), (113, 96), (87, 111)]
    front = [(17, 62), (87, 68), (87, 111), (17, 103)]
    arch = curve((17, 62), (15, 34), (27, 22), (47, 25))
    arch += curve((47, 25), (70, 26), (86, 40), (87, 68))[1:]
    lid = arch + [(17, 62)]
    lid_side = curve((47, 25), (64, 19), (82, 19), (92, 25))
    lid_side += curve((92, 25), (107, 28), (114, 39), (113, 50))[1:]
    lid_side += [(87, 68)] + list(reversed(arch[24:]))
    gradient(side, rim_dark, dark)
    gradient(front, light, dark)
    gradient(lid_side, rim_light, rim_dark)
    gradient(lid, light, dark)

    # 木纹保留在所有箱体上, 金属版本用较淡细纹表达金属覆板与木芯结构.
    grain = "#673c24" if name == "wood" else edge
    gleam = "#edba72" if name == "wood" else shine
    for y in (42, 52, 79, 91):
        start, end = (24, 77) if y < 60 else (21, 83)
        line([(start, y), (start+13, y-1), (start+30, y+1), (end, y+2)], grain, .75)
        line([(start+3, y+1.5), (start+15, y+.5), (start+30, y+2.5)], gleam, .5)
    for cx, cy in ((49, 46), (66, 88), (40, 98)):
        ellipse((cx-4, cy-1.4, cx+4, cy+1.4), None, grain, .65)
        line([(cx-1.7, cy), (cx+1.5, cy+.2)], grain, .55)
    line([(96, 71), (108, 65)], edge, .8)
    line([(96, 84), (108, 78)], edge, .8)

    # 两道金属箍包覆弧盖和箱体, 高光内沿与暗面形成可读的厚度.
    for x in (25, 74):
        top_y = 33 if x == 25 else 37
        band = curve((x, 62+(x-17)*6/70), (x-2, 48), (x-1, top_y+5), (x+3, top_y))
        band += [(x+10, top_y+3)]
        band += curve((x+10, top_y+3), (x+5, top_y+14), (x+6, 53), (x+7, 63+(x-17)*6/70))[1:]
        polygon(band, rim_light)
        line([(x+2, 59), (x+1, 48), (x+3, top_y+6)], shine, 1.1)
        strip = [(x, 65+(x-17)*6/70), (x+7, 65+(x-10)*6/70),
                 (x+7, 103+(x-10)*8/70), (x, 103+(x-17)*8/70)]
        gradient(strip, rim_light, rim_dark)
        line([(x+1.7, 71), (x+1.7, 101+(x-17)*8/70)], shine, .85)
        for y in (76, 98):
            ellipse((x+2, y, x+5, y+3), edge, INK, .45)
            ellipse((x+2.1, y+.1, x+3.2, y+1.1), shine)

    # 盖缝贯穿前侧和右侧, 明确表现为关闭状态而非敞口箱.
    polygon([(17, 60), (87, 66), (113, 48), (113, 53), (87, 71), (17, 65)], rim_dark)
    line([(18, 61), (87, 67), (112, 50)], shine, .85)
    polygon([(17, 99), (87, 107), (113, 92), (113, 97), (87, 112), (17, 104)], rim_dark)
    line([(19, 100), (87, 108), (111, 94)], rim_light, 1)
    # 右侧角条和小铆钉, 避免侧面成为没有结构的平面.
    polygon([(108, 56), (113, 53), (113, 96), (108, 99)], rim_dark)
    line([(109, 59), (109, 94)], rim_light, .8)
    for x, y in ((20, 69), (20, 96), (91, 74), (91, 101), (110, 62), (110, 89)):
        ellipse((x-1, y-1, x+1, y+1), shine, edge, .5)

    # 所有材质共用金属锁扣和钥匙孔, 色调随包边变化.
    polygon([(51, 59), (61, 60), (61, 72), (51, 71)], rim_dark)
    line([(53, 61), (59, 61.5), (59, 67)], shine, .8)
    lock = [(48, 69), (62, 70), (65, 74), (65, 86), (61, 90), (49, 89), (46, 85), (46, 73)]
    gradient(lock, shine, rim_dark)
    line([(49, 73), (49, 84), (51, 86)], rim_light, 1)
    ellipse((53, 75, 58, 80), edge, INK, .65)
    polygon([(54.6, 78), (56.2, 78), (57.5, 84), (53.3, 83.7)], edge, None)

    # 小面积镜面亮斑呼应现有金币/银币/钻石, 不遮挡整体轮廓.
    line([(33, 29), (40, 27.5), (47, 28)], shine, 1.2)
    sparkle_color = "#fff4c4" if name in ("wood", "copper", "gold") else "#edfcff"
    polygon([(105, 24), (106.4, 29.1), (111, 31), (106.4, 32.2),
             (105, 37), (103.6, 32.2), (99, 31), (103.6, 29.1)], sparkle_color, edge, .45)
    line([(105, 27), (105, 34)], "#ffffff", .65)
    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def validate(path):
    """重新打开实际输出, 同时检查文件可解码、透明背景和有效非透明图形."""
    with Image.open(path) as image:
        assert image.format == "PNG", f"不是 PNG: {path}"
        image.verify()
    with Image.open(path) as image:
        image.load()
        assert image.size == (128, 128), f"尺寸错误: {path}"
        assert image.mode == "RGBA", f"没有 RGBA 通道: {path}"
        alpha = image.getchannel("A")
        assert alpha.getextrema() == (0, 255), f"缺少透明背景或实体图形: {path}"
        assert all(image.getpixel(p)[3] == 0 for p in ((0, 0), (127, 0), (0, 127), (127, 127)))
        print(f"成功: {path.relative_to(ROOT).as_posix()} | PNG 128x128 RGBA | alpha=0..255")


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    icons = []
    for name, palette in PALETTES.items():
        image = render(name, palette)
        path = DEST / f"{name}.png"
        image.save(path, "PNG")
        validate(path)
        icons.append((name, image))

    # 联排预览使用浅深交错底格, 便于同时检查描边和透明区域.
    preview = Image.new("RGB", (760, 190), "#202936")
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=15)
    for i, (name, image) in enumerate(icons):
        x = 12+i*150
        for row in range(8):
            for col in range(8):
                fill = "#364251" if (row+col) % 2 else "#414e5e"
                draw.rectangle((x+col*16, 12+row*16, x+col*16+15, 12+row*16+15), fill=fill)
        preview.paste(image, (x, 12), image)
        draw.text((x+64, 154), name, fill="#e7edf5", font=font, anchor="mt")
    preview.save(PREVIEW, "PNG")
    with Image.open(PREVIEW) as check:
        check.verify()
    print(f"成功: {PREVIEW.relative_to(ROOT).as_posix()} | 760x190 联排预览")


if __name__ == "__main__":
    main()
