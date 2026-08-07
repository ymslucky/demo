# LuckyLab 个人网站

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

## 部署

本站通过 GitHub Actions 自动部署到 GitHub Pages，线上地址：
**https://ymslucky.github.io/demo/**

### 首次部署（仓库初始化）

```bash
# 1. 启用 GitHub Pages 并指定部署源为 GitHub Actions
gh api -X POST repos/ymslucky/demo/pages \
  -f build_type=workflow
# 或通过 REST：
# POST /repos/{owner}/{repo}/pages  body: { "build_type": "workflow" }

# 2. 推送代码到 main 分支
git push origin main
```

推送后 `.github/workflows/deploy.yml` 会自动触发：安装依赖 → 构建静态文件 → 上传产物 → 部署到 Pages。HTTPS 证书由 GitHub 自动签发，部署完成后即可通过 `https://` 访问。

### 从全新克隆重新部署

```bash
git clone https://github.com/ymslucky/demo.git
cd demo
npm install
npm run build          # 本地构建验证
git push origin main   # 推送即触发线上部署
```

### 自定义域名（可选）

如需绑定自定义域名，在 GitHub 仓库 Settings → Pages → Custom domain 中填入域名，并在 DNS 服务商添加以下记录：

| 类型  | 名称 | 值                       |
|-------|------|--------------------------|
| CNAME | www  | ymslucky.github.io       |
| A     | @    | 185.199.108.153          |
| A     | @    | 185.199.109.153          |
| A     | @    | 185.199.110.153          |
| A     | @    | 185.199.111.153          |

GitHub 会为自定义域名自动签发并续期 HTTPS 证书。

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
