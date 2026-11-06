// 测试入口钩子：npm test 通过 `node --import` 加载本文件，
// 注册 three specifier 映射（见 three-hook.mjs）。
import { register } from "node:module";
register(new URL("./three-hook.mjs", import.meta.url));