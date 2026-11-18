import { PAGE } from "./layout";
import type { ManualSnapshot } from "../model/snapshot";

/**
 * 把渲染好的页面打包成单个自包含 HTML 下载。
 * 版式完全由固定坐标决定，不读取设备参数，
 * 因此手机与桌面下载同一作品得到逐字节相同的内容。
 */
export function packManual(snap: ManualSnapshot, pages: string[]) {
  const css = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700&family=Noto+Serif+SC:wght@600&display=swap');
:root{font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;color:#35453b;background:#eceee7}
body{margin:0;padding:32px 12px;display:flex;flex-direction:column;align-items:center;gap:28px}
.sheet{width:${PAGE.w}px;max-width:100%;background:#fff;box-shadow:0 2px 18px rgba(53,69,59,.16);border-radius:4px;overflow:hidden}
.sheet svg{display:block;width:100%;height:auto}
.meta{color:#7c887a;font-size:12px;text-align:center}
@media print{
  body{padding:0;gap:0;background:#fff}
  .sheet{box-shadow:none;border-radius:0;page-break-after:always;break-after:page}
  @page{size:A4 portrait;margin:0}
}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>折间 ORI 说明书 · ${snap.paper.name} · ${snap.version}</title>
<style>${css}</style>
</head>
<body>
<p class="meta">折间 ORI · ${snap.paper.name} · 共 ${pages.length} 页 · 版本 ${snap.version} · 打印时请选择 A4 纵向</p>
${pages.map((p, i) => `<section class="sheet" id="p${i + 1}">${p}</section>`).join("\n")}
<p class="meta">同一作品在任何设备上导出内容一致 · 版本码 ${snap.version}</p>
</body>
</html>`;
}

export function downloadManual(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
