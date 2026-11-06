// Node 测试专用：把裸 specifier "three" 映射到内置的 vendor three.js，
// 让 pose.js 等依赖 three 的模块也能在 Node 里直接单测（无需安装/构建）。
// 由 register-three.mjs 通过 node --import 注册，浏览器端不受影响。
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return nextResolve(
      new URL("../assets/vendor/three.module.min.js", import.meta.url).href,
      context,
    );
  }
  return nextResolve(specifier, context);
}