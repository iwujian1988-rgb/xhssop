import type { Metadata } from 'next';
import '@fontsource/lxgw-wenkai/500.css';
import './globals.css';

export const metadata: Metadata = {
  title: '小红书笔记台',
  description: '选参考封面，迁移选题，生成可发布的小红书带货笔记',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
