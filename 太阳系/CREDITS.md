# 太阳系 · 素材致谢与许可

天体表面位图与环剖面数据来自公开权威档案；程序化表面与全部代码为原创。
各素材的再分发约束以本文件为准。

## 天体表面位图（assets/textures/）

| 文件 | 来源与版本 | 署名 | 许可 |
| --- | --- | --- | --- |
| earth_2k.jpg | NASA Earth Observatory「Blue Marble Next Generation」(Reto Stöckli)，200412 全球无云合成（含地形/水深）；经 Wikimedia Commons 公有领域镜像降采样至 2048×1024 | NASA Earth Observatory (Reto Stöckli) | 公有领域 (PD-USGov NASA) |
| moon_2k.jpg | NASA/GSFC Scientific Visualization Studio「CGI Moon Kit」(svs.gsfc.nasa.gov/4720)，LROC/LOLA 彩色全球底图 lroc_color_poles_4k.tif，4096×2048 → 2048×1024（原件经 Wayback 存档取得） | NASA/GSFC/Scientific Visualization Studio | 公有领域 (NASA) |

其余行星贴图与土星环素材的致谢随对应阶段补充。

## 土星环光学深度剖面（assets/data/saturn_ring_tau.csv）

Saturn ring tau(r): Voyager 1 RSS X-band occultation (1980-11-13), PDS VG_2803
(Showalter 2004), NASA Planetary Data System Ring-Moon Systems Node.

许可：NASA/PDS 公有领域（美国政府作品）；引用请求遵循 PDS 数据政策。
完整引用、测量方法（X 波段 3.6 cm，衍射校正）与处理文献
（Marouf/Tyler/Rosen 1986；Zebker/Marouf/Tyler 1985）见 CSV 头部注释。
由 `tools/bake_ring_profile.py` 确定性烘制为 `assets/solar/ring-profile.js`。

## 天体物理参数（assets/solar/bodies.js）

- 轨道：JPL SSD Approximate Positions of the Planets, Table 1（J2000 要素 + 每世纪速率）
- 平均半径 / 卫星数：NSSDCA Planetary Fact Sheets（卫星数为 2026-11 JPL 快照）
- 自转 / 极轴：IAU WGCCRE 2015 / NAIF pck00011.tpc
- 形状（赤道/极半径）：NAIF pck00011.tpc 三轴 RADII

以上均为美国政府机构 / 国际科学组织公开数据成果，无版权限制。