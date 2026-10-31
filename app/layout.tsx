import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asset Forge · 游戏资产编辑器",
  description: "按账号保存游戏资产配置, 同步并导出本地 YAML.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
