#!/usr/bin/env python3
"""用 Python 画一棵圣诞树。

两种画法：
    * 默认：终端 ASCII 版（分层树冠 + 星星 + 彩球 + 树干 + 雪地）
    * --turtle：图形版，用标准库 turtle 画一张彩色圣诞树（需要图形界面）

用法:
    python tools/christmas_tree.py                  # 默认高度
    python tools/christmas_tree.py --height 16      # 更高的树
    python tools/christmas_tree.py --tiers 4        # 更多层树冠
    python tools/christmas_tree.py --no-color       # 关闭 ANSI 颜色
    python tools/christmas_tree.py --animate        # 逐行生长动画
    python tools/christmas_tree.py --turtle         # 图形版

图案只用 ASCII 字符，因此在任何终端宽度下都不会错位。
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time

# ---------------------------------------------------------------- ANSI 颜色
RESET = "\033[0m"
COLORS = {
    "star": "\033[1;33m",  # 亮黄
    "leaf": "\033[32m",  # 绿
    "ornament": "\033[1;31m",  # 亮红
    "trunk": "\033[33m",  # 棕黄
    "snow": "\033[36m",  # 青
    "text": "\033[1;37m",  # 亮白
}

LEAF = "*"
TRUNK = "|"
ORNAMENTS = ("o", "O", "@", "+")
SNOW = "="


def enable_windows_ansi() -> None:
    """在 Windows 控制台打开 VT 转义支持，失败就静默忽略。"""
    if os.name != "nt":
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except Exception:
        pass


# ---------------------------------------------------------------- 构图
Cell = tuple[str, str]  # (字符, 用途)


def build_canvas(height: int, tiers: int, seed: int) -> list[list[Cell]]:
    """把整棵树画到字符网格上，返回若干行，每行是 (字符, 用途) 的列表。"""
    height = max(3, height)
    tiers = max(1, min(tiers, max(1, height // 2)))

    tier_h = max(1, height // tiers)
    # 层与层之间的"收窄"（半宽）和下一层起点增量：收窄太多会出现断层，太少看不出层次
    notch = max(1, tier_h // 3)
    step = max(1, tier_h - 1 - notch)

    # 每一行的"半宽"：第 t 层从 1 + t*step 开始，逐行 +1（从 1 开始，树尖就是 3 格宽）
    halves = [1 + t * step + j for t in range(tiers) for j in range(tier_h)]
    max_half = halves[-1]
    center = max_half
    width = 2 * max_half + 1

    grid: list[list[Cell]] = [
        [(" ", "space") for _ in range(width)] for _ in range(len(halves))
    ]

    # 树冠
    for r, half in enumerate(halves):
        for c in range(center - half, center + half + 1):
            grid[r][c] = (LEAF, "leaf")

    # 彩球：不压在左右轮廓上，保持树形清晰
    rng = random.Random(seed)
    for r, half in enumerate(halves):
        if half < 2:
            continue
        for _ in range(rng.choice((0, 1, 1, 2))):
            c = rng.randint(center - half + 1, center + half - 1)
            if grid[r][c][0] == LEAF:
                grid[r][c] = (rng.choice(ORNAMENTS), "ornament")

    # 树干
    trunk_h = max(2, min(5, len(halves) // 4))
    trunk_half = 1 if width >= 7 else 0
    for _ in range(trunk_h):
        row: list[Cell] = [(" ", "space") for _ in range(width)]
        for c in range(center - trunk_half, center + trunk_half + 1):
            row[c] = (TRUNK, "trunk")
        grid.append(row)

    # 雪地
    grid.append([(SNOW, "snow") for _ in range(width)])

    # 星星：树尖正上方一颗，避免和树尖三角形重复
    star_rows: list[list[Cell]] = [[("*", "star")]]
    top: list[list[Cell]] = []
    for star_row in star_rows:
        line: list[Cell] = [(" ", "space") for _ in range(width)]
        offset = center - len(star_row) // 2
        for i, cell in enumerate(star_row):
            line[offset + i] = cell
        top.append(line)

    return top + grid


def render(grid: list[list[Cell]], color: bool) -> list[str]:
    lines: list[str] = []
    for row in grid:
        if not color:
            lines.append("".join(ch for ch, _ in row).rstrip())
            continue
        buf: list[str] = []
        for ch, kind in row:
            code = COLORS.get(kind, "")
            if code and ch != " ":
                buf.append(code + ch + RESET)
            else:
                buf.append(ch)
        lines.append("".join(buf).rstrip())
    return lines


def center_text(text: str, width: int) -> str:
    return text.center(width).rstrip()


# ---------------------------------------------------------------- 输出
def print_ascii_tree(args: argparse.Namespace) -> None:
    grid = build_canvas(args.height, args.tiers, args.seed)
    width = len(grid[0])
    body = render(grid, color=args.color)

    lines = body + [
        "",
        center_text("Merry Christmas!", width),
        center_text("~ happy new year ~", width),
        "",
    ]

    if not args.animate:
        for line in lines:
            print(line)
        return

    for line in lines:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
        time.sleep(args.delay)


# ---------------------------------------------------------------- 图形版
def draw_turtle_tree(height: int = 11) -> None:
    """用 turtle 画一张彩色圣诞树，需要图形界面。"""
    import turtle

    screen = turtle.Screen()
    screen.setup(900, 800)
    screen.bgcolor("#0b1026")
    screen.title("Merry Christmas")
    pen = turtle.Turtle()
    pen.hideturtle()
    pen.speed("fastest")

    def polygon(points, fill, outline=None):
        pen.penup()
        pen.goto(points[0])
        pen.pendown()
        pen.color(outline or fill, fill)
        pen.begin_fill()
        for point in points[1:]:
            pen.goto(point)
        pen.goto(points[0])
        pen.end_fill()

    base_y = -300
    trunk_w, trunk_h = 44, max(60, height * 6)

    # 树干
    polygon(
        [
            (-trunk_w / 2, base_y),
            (trunk_w / 2, base_y),
            (trunk_w / 2, base_y + trunk_h),
            (-trunk_w / 2, base_y + trunk_h),
        ],
        "#7a4a25",
    )

    # 分层树冠
    tiers = max(3, round(height / 3))
    tier_h = 360 / tiers
    max_half = 210
    rng = random.Random(20251225)
    tier_shapes = []
    for i in range(tiers):
        y0 = base_y + trunk_h + i * tier_h * 0.82
        half = max_half * (i + 1) / tiers
        tier_shapes.append((y0, y0 + tier_h * 1.25, half))

    for index, (y0, apex_y, half) in enumerate(tier_shapes):
        shade = "#1e7a3d" if index % 2 == 0 else "#186331"
        polygon([(0, apex_y), (-half, y0), (half, y0)], shade, "#0f3d1f")

    # 彩球
    for _ in range(tiers * 7):
        y0, apex_y, half = rng.choice(tier_shapes)
        y = rng.uniform(y0 + 12, apex_y - 12)
        spread = half * (y - y0) / max(1.0, apex_y - y0)
        pen.penup()
        pen.goto(rng.uniform(-spread, spread), y)
        pen.dot(rng.uniform(9, 16), rng.choice(("#ff4d4d", "#ffd93d", "#5bc0ff")))

    # 顶部五角星
    top_y = tier_shapes[-1][1]
    star_r = 34
    points = []
    for i in range(10):
        radius = star_r if i % 2 == 0 else star_r * 0.45
        angle = 90 + i * 36
        rad = angle * 3.141592653589793 / 180
        points.append((radius * -_cos(rad), top_y + radius * _sin(rad)))
    polygon(points, "#ffd93d", "#ffb300")

    # 雪地
    polygon([(-450, base_y - 10), (450, base_y - 10), (450, -400), (-450, -400)], "#e8f2ff")

    screen.exitonclick()


def _cos(rad: float) -> float:
    import math

    return math.cos(rad)


def _sin(rad: float) -> float:
    import math

    return math.sin(rad)


# ---------------------------------------------------------------- CLI
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="用 Python 画一棵圣诞树（终端 ASCII 版 / turtle 图形版）",
    )
    parser.add_argument("--height", type=int, default=11, help="树高，默认 11")
    parser.add_argument("--tiers", type=int, default=3, help="树冠层数，默认 3")
    parser.add_argument("--seed", type=int, default=20251225, help="彩球随机种子")
    parser.add_argument("--animate", action="store_true", help="逐行生长动画")
    parser.add_argument("--delay", type=float, default=0.06, help="动画每行间隔秒数")
    parser.add_argument("--no-color", action="store_true", help="关闭 ANSI 颜色")
    parser.add_argument("--color", action="store_true", help="强制开启 ANSI 颜色")
    parser.add_argument("--turtle", action="store_true", help="改用 turtle 画图形版")
    args = parser.parse_args(argv)

    if args.no_color:
        args.color = False
    elif args.color:
        args.color = True
    else:
        args.color = bool(getattr(sys.stdout, "isatty", lambda: False)())

    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    enable_windows_ansi()

    if args.turtle:
        try:
            draw_turtle_tree(args.height)
        except Exception as exc:  # turtle 需要图形界面 / Tk
            print(f"无法启动 turtle 图形版：{exc}", file=sys.stderr)
            print("可以改用终端 ASCII 版：python christmas_tree.py", file=sys.stderr)
            return 1
        return 0

    print_ascii_tree(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
