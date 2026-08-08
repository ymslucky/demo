# LuckyLab — 个人网站

独立开发者个人网站，专注于 Web 应用与自动化工具的全栈开发。

## 技术栈

- **框架**: Next.js 16 (App Router, Turbopack)
- **语言**: TypeScript 5.7
- **样式**: 纯 CSS (CSS 变量 + Flex/Grid)
- **部署**: EdgeOne Makers (SSR/SSG 原生支持)
- **字体**: Inter (Google Fonts)

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器 (http://localhost:3000)
npm run dev

# 生产构建
npm run build

# 启动生产服务器
npm start
```

## 代码质量

```bash
# TypeScript 类型检查
npx tsc --noEmit

# ESLint 检查
npm run lint

# 运行单元测试
npm test
```

## 项目结构

```
app/
├── layout.tsx          # 根布局 (全局 metadata、字体、Nav/Footer)
├── page.tsx            # 首页 (Hero)
├── globals.css         # 全局样式 + 设计变量
├── about/              # 关于页
├── projects/           # 项目展示
├── tools/              # 在线工具 (JSON/Base64/时间戳/单位/颜色/文本)
├── links/              # 导航链接
├── contact/            # 联系方式
├── robots.ts           # SEO robots.txt
└── sitemap.ts          # SEO sitemap.xml
```

## 部署

项目部署在 EdgeOne Makers 平台：

- **URL**: https://luckylab-demo-qpqxce5k.edgeone.cool
- **构建命令**: `npm run build`
- **输出目录**: `.next`
- **Node 版本**: 22.11.0

推送代码到 `main` 分支后，EdgeOne 会自动构建和部署。

## License

MIT License — see [LICENSE](LICENSE) for details.
