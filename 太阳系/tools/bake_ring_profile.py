#!/usr/bin/env python3
"""从 PDS Voyager RSS τ(r) 实测剖面烘制土星环不透明度数据模块。

用法（仓库根目录下）：
    python 太阳系/tools/bake_ring_profile.py

输入：太阳系/assets/data/saturn_ring_tau.csv
      （Voyager 1 RSS X 波段 3.6 cm 出掩剖面，PDS VG_2803 RS3P2X.TAB，
        10 km 采样；来源署名与许可见 CSV 头部）
输出：太阳系/assets/solar/ring-profile.js
      （2048 个 τ 采样，覆盖 C 环内缘 74,658 km 至 A 环外缘 136,780 km，
        ~30 km/texel，恩克缝 325 km 宽可分辨；负值噪声钳到 0）

纯离线生成，站点运行时无需 fetch；重新生成是确定性的。
"""
import bisect
import csv
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "太阳系" / "assets" / "data" / "saturn_ring_tau.csv"
OUT_PATH = ROOT / "太阳系" / "assets" / "solar" / "ring-profile.js"

# 与 bodies.js SATURN.ring 一致；tests/ring-profile.test.mjs 会交叉校验
INNER_KM = 74658.0
OUTER_KM = 136780.0
N = 2048


def load_profile():
    lines = []
    with open(CSV_PATH, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            lines.append(line)
    reader = csv.reader(lines)
    header = next(reader)
    assert header[:2] == ["radius_km", "tau"], f"意外表头: {header}"
    data = []
    for row in reader:
        r, tau = float(row[0]), float(row[1])
        data.append((r, max(0.0, tau)))  # 155 个微负值为噪声，钳到 0
    data.sort(key=lambda p: p[0])
    return data


def main():
    data = load_profile()
    xs = [r for r, _ in data]
    assert xs[0] <= INNER_KM and xs[-1] >= OUTER_KM, "CSV 覆盖范围不足"

    def tau_at(km):
        i = bisect.bisect_left(xs, km)
        if i <= 0:
            return data[0][1]
        if i >= len(data):
            return data[-1][1]
        x0, y0 = data[i - 1]
        x1, y1 = data[i]
        return y0 + (y1 - y0) * (km - x0) / (x1 - x0)

    taus = [
        round(tau_at(INNER_KM + (OUTER_KM - INNER_KM) * i / (N - 1)), 4)
        for i in range(N)
    ]

    rows = []
    for i in range(0, N, 16):
        rows.append("    " + ", ".join(f"{v:.4f}" for v in taus[i:i + 16]) + ",")
    body = "\n".join(rows)

    OUT_PATH.write_text(
        "/* ============================================================\n"
        "   土星环 · 法向光学深度 τ(r) 实测剖面（自动生成，勿手改）\n"
        "   生成：python 太阳系/tools/bake_ring_profile.py\n"
        "   来源：assets/data/saturn_ring_tau.csv —— Voyager 1 RSS X 波段\n"
        "   (3.6 cm) 出掩剖面，PDS VG_2803 RS3P2X.TAB（Showalter 2004），\n"
        "   NASA/PDS 公有领域；完整署名见 CSV 头部与 CREDITS.md。\n"
        "   采样：74,658–136,780 km 线性映射到 2048 点（~30 km/texel），\n"
        "   原始 10 km 网格线性插值；负值噪声已钳到 0。\n"
        "   注意：单条掩星弦切线，非方位平均；B 环高不透明区 τ 可能是下限。\n"
        "   ============================================================ */\n"
        "export const RING_PROFILE = {\n"
        f"  innerKm: {INNER_KM:.0f},\n"
        f"  outerKm: {OUTER_KM:.0f},\n"
        f"  samples: {N},\n"
        "  tau: [\n"
        f"{body}\n"
        "  ],\n"
        "};\n",
        encoding="utf-8",
    )
    print(f"written {OUT_PATH} ({N} samples, "
          f"tau max {max(taus):.4f}, min {min(taus):.4f})")


if __name__ == "__main__":
    main()