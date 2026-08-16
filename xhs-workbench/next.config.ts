import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // NEXT_DIST_DIR：允许在用户 dev server（.next）之外跑第二个实例
  // （如 AI 桥接验证用的生产构建），互不干扰。
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
