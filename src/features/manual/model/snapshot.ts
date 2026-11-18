import type { Document, Paper, Step } from "../../../shared/types";

/**
 * 说明书导出用的不可变快照。
 * 导出开始时深拷贝一次，之后所有页面都只读取快照，
 * 用户在导出期间继续编辑不会混入新版本页面。
 */
export interface ManualSnapshot {
  paper: Paper;
  steps: Step[];
  front: string;
  back: string;
  /** 内容指纹，作为版本码印在每一页上 */
  version: string;
}

/** 与渲染相关的字段，指纹只覆盖这些，保证同一作品任何设备结果一致 */
function sourceOf(doc: Document) {
  return {
    paper: doc.paper,
    steps: doc.steps,
    front: doc.front,
    back: doc.back,
  };
}

function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function fingerprintOf(doc: Document) {
  return hash(JSON.stringify(sourceOf(doc)));
}

export function takeSnapshot(doc: Document): ManualSnapshot {
  const source = JSON.parse(JSON.stringify(sourceOf(doc))) as Omit<
    ManualSnapshot,
    "version"
  >;
  return { ...source, version: fingerprintOf(doc) };
}
