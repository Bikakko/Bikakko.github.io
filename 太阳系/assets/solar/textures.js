/* ============================================================
   太阳系 · Solar · 位图贴图管线
   天体表面默认程序化着色器；真实位图（NASA/USGS 等）是渐进增强：
   异步加载，成功后覆盖底色，失败/未加载时保留程序化表面。
   色彩约定：
   - 自定义行星 shader 绕过 three 色彩管线（直接输出采样值），
     位图按 sRGB 存储、保持 NoColorSpace 原样采样才能显示正确颜色；
   - 标准材质（月球）走内建管线，需要 SRGBColorSpace 让 three 解码。
   贴图来源与许可见 CREDITS.md。
   ============================================================ */
import * as THREE from "three";

// 1×1 白图兜底：贴图未加载时采样器也有合法纹理绑定，避免采样空纹理
const WHITE_DATA = new Uint8Array([255, 255, 255, 255]);
export const WHITE_TEX = new THREE.DataTexture(WHITE_DATA, 1, 1, THREE.RGBAFormat);
WHITE_TEX.needsUpdate = true;

// 把加载好的贴图应用到材质。与加载器分离，便于 Node 离线测试。
export function applyBodyMap(material, tex, { anisotropy = 1 } = {}) {
  tex.colorSpace = material.isMeshStandardMaterial
    ? THREE.SRGBColorSpace
    : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  if (material.uniforms && material.uniforms.uMap) {
    material.uniforms.uMap.value = tex;
    material.uniforms.uHasMap.value = 1;
  } else {
    // 标准材质：底色与贴图相乘，必须重置为白，否则原灰色调会压暗位图
    material.map = tex;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  }
  return tex;
}

// 异步挂载：失败只警告，不影响场景（uHasMap 保持 0，走程序化回退）
export function attachBodyMap(material, url, opts = {}) {
  new THREE.TextureLoader().load(
    url,
    (tex) => applyBodyMap(material, tex, opts),
    undefined,
    (err) => console.warn(`[solar] 贴图加载失败，保留程序化表面: ${url}`, err),
  );
}