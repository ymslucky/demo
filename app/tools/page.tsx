import type { Metadata } from "next";
import ToolsClient from "./ToolsClient";

export const metadata: Metadata = {
  title: "在线工具",
  description:
    "常用在线工具箱 — JSON 格式化、Base64 编解码、时间戳转换、单位换算、颜色选择器等，全部本地运行。",
};

export default function ToolsPage() {
  return (
    <>
      <h1 className="page-title">在线工具</h1>
      <p className="page-subtitle">
        常用开发者与日常工具合集 — 所有运算均在浏览器本地完成，数据不上传
      </p>
      <ToolsClient />
    </>
  );
}
