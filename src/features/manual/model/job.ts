import type { Document } from "../../../shared/types";
import { fingerprintOf, takeSnapshot } from "./snapshot";
import { buildPlan } from "./plan";
import { renderPage } from "../lib/render";
import { downloadManual, packManual } from "../lib/pack";

export interface ManualResult {
  ok: boolean;
  cancelled: boolean;
  pages: number;
  noChange: number;
  version: string;
  notices: string[];
}

/** 每批渲染的页数；批间让出主线程，长教程不卡住界面 */
const BATCH = 4;

async function ensureFonts(): Promise<string | null> {
  try {
    if (!document.fonts?.load)
      return "无法检测字体状态，说明书文字将按各设备系统字体显示。";
    const loaded = await Promise.race([
      Promise.all([
        document.fonts.load('16px "Noto Sans SC"'),
        document.fonts.load('600 16px "Noto Serif SC"'),
      ]).then((r) => r.every((faces) => faces.length > 0)),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
    return loaded
      ? null
      : "字体加载失败，说明书文字将按各设备系统字体显示，版式不受影响。";
  } catch {
    return "字体加载失败，说明书文字将按各设备系统字体显示，版式不受影响。";
  }
}

const cancelledResult = (notices: string[]): ManualResult => ({
  ok: false,
  cancelled: true,
  pages: 0,
  noChange: 0,
  version: "",
  notices,
});

export function runManualExport(
  doc: Document,
  onProgress: (done: number, total: number) => void,
) {
  let cancelled = false;
  const done = (async (): Promise<ManualResult> => {
    const notices: string[] = [];
    // 先取快照：之后所有页面只读快照，导出期间的编辑不会混入
    const snap = takeSnapshot(doc);
    try {
      const fontNote = await ensureFonts();
      if (fontNote) notices.push(fontNote);
      const plan = buildPlan(snap);
      onProgress(0, plan.pages.length);
      const pages: string[] = [];
      for (let i = 0; i < plan.pages.length; i += BATCH) {
        if (cancelled) return cancelledResult(notices);
        for (let j = i; j < Math.min(i + BATCH, plan.pages.length); j++)
          pages.push(renderPage(snap, plan, j + 1));
        onProgress(pages.length, plan.pages.length);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cancelled) return cancelledResult(notices);
      if (fingerprintOf(doc) !== snap.version)
        notices.push(
          `导出期间检测到新的修改，未混入本册；本册版本码 ${snap.version}，如需包含修改请重新导出。`,
        );
      if (plan.noChangeSteps.length)
        notices.push(
          `${plan.noChangeSteps.length} 个步骤无形态变化，已保留对应页面并标注。`,
        );
      downloadManual(
        packManual(snap, pages),
        `ORI-说明书-${snap.paper.id}-${snap.version}.html`,
      );
      return {
        ok: true,
        cancelled: false,
        pages: pages.length,
        noChange: plan.noChangeSteps.length,
        version: snap.version,
        notices,
      };
    } catch (e) {
      notices.push("导出失败：" + (e instanceof Error ? e.message : String(e)));
      return {
        ok: false,
        cancelled: false,
        pages: 0,
        noChange: 0,
        version: snap.version,
        notices,
      };
    }
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}
