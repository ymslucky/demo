# LuckyLab — 个人网站

独立开发者个人网站，专注于 Web 应用与自动化工具的全栈开发。

## 技术栈

- **框架**: Next.js 16 (App Router, Turbopack)
- **语言**: TypeScript 5.7
- **样式**: 纯 CSS (CSS 变量 + Flex/Grid)
- **国际化**: next-intl (中文默认 / English)
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
├── [locale]/           # 本地化路由段 (zh 为默认，不带前缀；/en 为英文)
│   ├── layout.tsx      # 根布局 (html lang、全局 metadata、字体、Nav/Footer)
│   ├── page.tsx        # 首页 (Hero)
│   ├── about/          # 关于页
│   ├── projects/       # 项目展示
│   ├── tools/          # 在线工具 (JSON/Base64/时间戳/单位/颜色/文本)
│   ├── links/          # 导航链接
│   ├── contact/        # 联系方式
│   └── components/     # Nav / Footer / LanguageSwitcher
├── globals.css         # 全局样式 + 设计变量
├── robots.ts           # SEO robots.txt
└── sitemap.ts          # SEO sitemap.xml (含两种语言变体)
i18n/
├── routing.ts          # 语言路由配置 (locales / defaultLocale / 前缀策略)
├── navigation.ts       # 语言感知的 Link / useRouter / usePathname
└── request.ts          # 按语言加载消息目录
messages/
├── zh.json             # 中文消息目录
└── en.json             # 英文消息目录
middleware.ts           # 语言协商 + HTTP 层脚本注入 (next-intl middleware)
```

新增语言：在 `i18n/routing.ts` 的 `locales` 中加入代码，新建 `messages/<code>.json`（与现有目录键结构一致，`tests/i18n.test.ts` 会校验键一致性），重新构建即可。

## 国际化

- 默认语言为中文，现有 URL（`/`、`/about` 等）保持不变；英文站点位于 `/en` 前缀下。
- 页面右上角提供语言切换控件，切换为客户端导航，不触发整页刷新。
- 所有面向用户的文案均通过 `useTranslations` / `getTranslations` 读取，无硬编码字符串。
- 缺少翻译键时：开发环境直接抛错（`i18n/request.ts` 的 `onError`），生产环境仅记录日志并渲染键路径（`getMessageFallback`），不会导致页面崩溃。

## 部署

项目部署在 EdgeOne Pages 平台（SSR，部署配置见 `edgeone.json`）：

- **URL**: https://www.rdom.cn
- **构建命令**: `npm run build`
- **输出目录**: `.next`
- **Node 版本**: 22.11.0

推送代码到 `main` 分支后，EdgeOne 会自动构建和部署。

### 环境变量

完整清单与说明见模板 [.env.example](.env.example)；本地开发用 `.env.local`（被 git 忽略，绝不提交真实密钥）。

| 变量 | 用途 | 未配置时 |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk 认证（登录、会话） | 认证不可用 |
| `SITE_DOMAIN` | 站点主域名；todo 鉴权白名单（issuer / azp）与站点对外 URL（RSS / sitemap / 元数据）均由此派生 | `rdom.cn` |
| `GITHUB_TOKEN` | 首页 GitHub Contributions 展示（提升 API 配额） | 无贡献图占位 |

### KV 绑定（EdgeOne 控制台配置，随部署注入边缘函数）

| 绑定变量 | 用途 |
| --- | --- |
| `TODO_LIST` | Todo List 数据持久化（按 Clerk 账号隔离） |
| `DICTIONARY` | 在线人数心跳 |

## License

MIT License — see [LICENSE](LICENSE) for details.
