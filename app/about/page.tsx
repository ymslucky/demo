import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "关于",
  description:
    "关于 LuckyLab — 独立开发者的技术栈、关注方向与开源贡献。",
};

const focusAreas = [
  "全栈 Web 应用开发",
  "AI 辅助开发与图像生成",
  "自动化与桌面效率工具",
  "数据可视化",
];

export default function AboutPage() {
  return (
    <>
      <h1 className="page-title">关于我</h1>
      <p className="page-subtitle">
        独立开发者 · 全栈 Web 应用 · 自动化工具
      </p>

      <div className="about-text">
        <p>
          我是一名独立开发者，热衷于用技术解决日常生活和工作中的实际问题。我的技术栈以
          TypeScript 和 Python
          为主，擅长使用 Next.js 构建现代 Web
          应用，也熟悉 Appwrite、Cloudflare 等无服务器（Serverless）平台的后端开发。
        </p>
        <p>
          除了 Web
          开发，我也对桌面端自动化工具和数据可视化充满兴趣——曾用 PySide6
          构建零代码自动化操作原型，用雷达图等可视化方式呈现复杂业务数据。我倾向于选择简洁、高效的技术方案，追求以最小的复杂度交付可用的产品。
        </p>
        <p>
          在开源方面，我维护了多个公开仓库，涵盖实用工具、导航站和数据可视化项目，也曾作为
          Arctic Code Vault Contributor
          参与过被 GitHub 永久存档的开源代码贡献。
        </p>
      </div>

      <div className="about-focus">
        <h2>当前关注方向</h2>
        <div className="focus-tags">
          {focusAreas.map((area) => (
            <span key={area} className="focus-tag">
              {area}
            </span>
          ))}
        </div>
      </div>

      <div className="about-honor">★ 荣誉：GitHub Arctic Code Vault Contributor</div>
    </>
  );
}
