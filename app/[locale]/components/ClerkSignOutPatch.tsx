"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __internal_onBeforeSetActive?: (intent?: "sign-out") => Promise<void>;
  }
}

/**
 * 修复子页面退出登录报 "An unexpected response was received from the server."
 *
 * 链路：@clerk/nextjs 的 ClerkProvider 在 `__internal_onBeforeSetActive` 里对
 * Next 15+/sign-out 做了 noop 短路（sign-out 后由 onAfterSetActive 的
 * router.refresh() 补偿），但短路条件是 `intent === "sign-out"`，而 clerk-js
 * 的 signOut() 调用该钩子时不传任何参数（`await i()`，intent 为 undefined），
 * 短路永远不命中 → 回退执行 invalidateCacheAction()（server action POST）。
 *
 * 该 POST 在本站部署形态（EdgeOne Pages 静态层 + 预渲染页面）下必炸：
 * - 首页 `/zh/`：POST 穿透静态层 → Next 返回 404 + X-Nextjs-Action-Not-Found，
 *   Next 16 客户端优雅处理，退出"看起来正常"；
 * - 其他预渲染子页：POST 被 EdgeOne 静态层用 200 缓存 HTML 吃掉（从未到达
 *   Next 服务器），Next 客户端发现 content-type 非 text/x-component 抛错，
 *   登出流程中断。
 *
 * 本组件在 ClerkProvider 注册钩子之后（父级 useSafeLayoutEffect 属 layout
 * 阶段，本组件 useEffect 属 passive 阶段，顺序由 React 保证）覆盖该钩子：
 * sign-out 场景（intent 为 undefined 或 "sign-out"）一律 noop resolve，
 * 与上游 Next 15+ 分支的设计意图一致；其他 intent 透传原实现。
 */
export default function ClerkSignOutPatch() {
  useEffect(() => {
    const original = window.__internal_onBeforeSetActive;
    if (typeof original !== "function") return;
    window.__internal_onBeforeSetActive = (intent) => {
      if (intent === undefined || intent === "sign-out") {
        return Promise.resolve();
      }
      return original(intent);
    };
    return () => {
      window.__internal_onBeforeSetActive = original;
    };
  }, []);

  return null;
}
