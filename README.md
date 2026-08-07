# ymslucky 个人网站

基于 Astro 构建的静态个人网站，部署于 GitHub Pages。

## 页面

- **首页** (`/`) — 标语 + 简介 + CTA
- **关于** (`/about`) — 技术栈、关注方向、开源荣誉
- **项目** (`/projects`) — 6 个精选项目卡片
- **联系** (`/contact`) — 邮箱、GitHub、个人域名

## 技术栈

- [Astro](https://astro.build) — 零 JS 静态站点生成器
- 原生 CSS（CSS 变量 + 响应式布局）
- 部署：GitHub Pages（通过 GitHub Actions）

## 本地开发

```bash
npm install
npm run dev      # 启动开发服务器 http://localhost:4321/demo/
```

## 构建

```bash
npm run build    # 输出到 ./dist
npm run preview  # 本地预览构建结果
```

## 配置说明

站点配置在 `astro.config.mjs` 中：
- `site`: `https://ymslucky.github.io`
- `base`: `/demo/`（GitHub Pages 子路径）

## 目录结构

```
src/
├── components/   Nav.astro, Footer.astro
├── layouts/      BaseLayout.astro
├── pages/        index, about, projects, contact
└── styles/       global.css
public/
└── favicon.svg
```

## License

MIT
