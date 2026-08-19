# XHS Workbench

本地运行的小红书法语资料带货笔记工作台。代码、商品事实卡和展示素材都在本目录内；批次结果与 API 密钥不会提交到仓库。

## 安装运行

```bash
npm install
copy .env.example .env.local
npm run dev
```

打开 `http://localhost:4000`。首次运行前，在 `.env.local` 填入可用的文本模型配置；需要生图时再填写图片模型配置。不要把真实密钥提交到 GitHub。

生产模式：

```bash
npm run build
npm run start
```

默认事实卡位于 `data/product_facts_delf_b2.json`、`data/product_facts_tef_tcf.json` 和 `data/product_facts_tcf_canada_7day.json`。如果事实卡放在其他位置，可在 `.env.local` 中配置对应路径。

- `public/reference-covers/` 是参考封面库。
- `public/showcase/` 是商品知识库展示截图。
- 批次 JSON、日志和临时验收页属于本机运行状态，不随仓库发布。

## Next.js

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
