import type { PoseFace, Vec3 } from "../../../shared/types";
import { hingePositions } from "../../fold/lib/kinematics";
import { BAND, PAGE } from "./layout";
import {
  arrowArc,
  centroid,
  foldKind,
  makeProjector,
  movingSet,
  sectionData,
  toCamera,
  type Projector,
} from "./diagram";
import type {
  CutawayPagePlan,
  ManualPlan,
  StepPagePlan,
} from "../model/plan";
import type { ManualSnapshot } from "../model/snapshot";

const INK = "#35453b",
  MUTED = "#7c887a",
  FAINT = "#a1a797",
  LINE = "#746f57",
  ACCENT = "#c2623a",
  PANEL_BG = "#fbfbf7",
  PANEL_LINE = "#e4e7df";
const SANS = "'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
const SERIF = "'Noto Serif SC','Songti SC',serif";
/** 谷折：虚线；山折：点划线（自纸张正面观察为准） */
const DASH = { valley: "7 5", mountain: "12 4 2 4", flat: "2 4" } as const;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const pad = (n: number) => String(n).padStart(2, "0");
const circled = (n: number) =>
  n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : String(n);
const num = (n: number) => String(Math.round(n * 10) / 10);

function text(
  x: number,
  y: number,
  s: string,
  size: number,
  fill = INK,
  anchor = "start",
  family = SANS,
  weight = 400,
  halo = false,
) {
  const paint = halo ? ` stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round"` : "";
  return `<text x="${num(x)}" y="${num(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-family="${family}" font-weight="${weight}"${paint}>${esc(s)}</text>`;
}

function badge(x: number, y: number, n: number, hot: boolean) {
  return `<circle cx="${num(x)}" cy="${num(y)}" r="10" fill="${hot ? ACCENT : "#f7f6ee"}" stroke="${hot ? ACCENT : PANEL_LINE}"/>` +
    text(x, y + 3.5, String(n), 10, hot ? "#fff" : "#555", "middle");
}

/** 折痕编号与山/谷标签分别放在折轴两侧，并避开运动面一侧，减少相邻折痕重叠 */
function labelSpots(
  a: { x: number; y: number },
  b: { x: number; y: number },
  away: { x: number; y: number },
) {
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2;
  let nx = -(b.y - a.y),
    ny = b.x - a.x;
  const nl = Math.hypot(nx, ny) || 1;
  nx /= nl;
  ny /= nl;
  if ((away.x - mx) * nx + (away.y - my) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    badge: { x: mx + nx * 17, y: my + ny * 17 },
    kind: { x: mx - nx * 24, y: my - ny * 24 },
  };
}

function arrowHead(tip: { x: number; y: number }, prev: { x: number; y: number }, color: string) {
  const dx = tip.x - prev.x,
    dy = tip.y - prev.y,
    len = Math.hypot(dx, dy) || 1,
    ux = dx / len,
    uy = dy / len,
    nx = -uy,
    ny = ux;
  const p1 = `${num(tip.x)},${num(tip.y)}`,
    p2 = `${num(tip.x - ux * 11 + nx * 5)},${num(tip.y - uy * 11 + ny * 5)}`,
    p3 = `${num(tip.x - ux * 11 - nx * 5)},${num(tip.y - uy * 11 - ny * 5)}`;
  return `<polygon points="${p1} ${p2} ${p3}" fill="${color}"/>`;
}

function arcSvg(points: Vec3[], proj: Projector, color: string, width: number, dash = "") {
  const pts = points.map(proj);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(p.y)}`).join("");
  const head = pts.length > 1 ? arrowHead(pts[pts.length - 1]!, pts[pts.length - 2]!, color) : "";
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linecap="round"/>${head}`;
}

/** 与视口一致的正/背面着色规则 */
function facesSvg(
  pose: PoseFace[],
  proj: Projector,
  view: { yaw: number; pitch: number },
  front: string,
  back: string,
) {
  const sorted = pose
    .map((f) => ({
      f,
      depth: f.points.reduce((s, p) => s + proj(p).z, 0) / f.points.length,
      flipped: toCamera(f.normal, view)[2] > 0,
    }))
    .sort((a, b) => a.depth - b.depth);
  return sorted
    .map(({ f, flipped }) => {
      const pts = f.points.map((p) => {
        const v = proj(p);
        return `${num(v.x)},${num(v.y)}`;
      }).join(" ");
      return `<polygon points="${pts}" fill="${flipped ? back : front}" stroke="#785945" stroke-opacity=".35" stroke-width="1.1" stroke-linejoin="round"/>`;
    })
    .join("");
}

function ghostSvg(pose: PoseFace[], ids: Set<string>, proj: Projector) {
  return pose
    .filter((f) => ids.has(f.id))
    .map((f) => {
      const pts = f.points.map((p) => {
        const v = proj(p);
        return `${num(v.x)},${num(v.y)}`;
      }).join(" ");
      return `<polygon points="${pts}" fill="${INK}" fill-opacity=".06" stroke="${MUTED}" stroke-width="1" stroke-dasharray="4 3"/>`;
    })
    .join("");
}

function panelFrame(b: { x: number; y: number; w: number; h: number }, title: string, tag = "") {
  return (
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${PANEL_BG}" stroke="${PANEL_LINE}"/>` +
    text(b.x + 14, b.y + 24, title, 11, MUTED, "start", SANS, 600) +
    (tag ? text(b.x + b.w - 14, b.y + 24, tag, 9, FAINT, "end") : "")
  );
}

function header(snap: ManualSnapshot) {
  return (
    text(PAGE.margin, BAND.header.y + 18, "折间 ORI · 折叠说明书", 15, INK, "start", SERIF, 600) +
    text(PAGE.w - PAGE.margin, BAND.header.y + 18, "版本 " + snap.version, 10, FAINT, "end") +
    `<line x1="${PAGE.margin}" y1="${BAND.header.y + 34}" x2="${PAGE.w - PAGE.margin}" y2="${BAND.header.y + 34}" stroke="${PANEL_LINE}"/>`
  );
}

function footer(snap: ManualSnapshot, pageNo: number, total: number, identity: string) {
  const y = BAND.footer.y;
  return (
    text(PAGE.margin, y, `折间 ORI · ${snap.paper.name} · 版本 ${snap.version}`, 9, FAINT) +
    (identity ? text(PAGE.w / 2, y, identity, 9, MUTED, "middle") : "") +
    text(PAGE.w - PAGE.margin, y, `第 ${pageNo} / ${total} 页`, 9, FAINT, "end")
  );
}

function legendStrip() {
  const y = BAND.legend.y + 16;
  const item = (x: number, sample: string, label: string) =>
    sample + text(x + 46, y + 4, label, 9, MUTED);
  const valley = `<line x1="48" y1="${y}" x2="86" y2="${y}" stroke="${LINE}" stroke-width="1.6" stroke-dasharray="${DASH.valley}"/>`;
  const mountain = `<line x1="160" y1="${y}" x2="198" y2="${y}" stroke="${LINE}" stroke-width="1.6" stroke-dasharray="${DASH.mountain}"/>`;
  const arrow = `<path d="M272 ${y + 4} Q 288 ${y - 14} 304 ${y - 2}" fill="none" stroke="${ACCENT}" stroke-width="1.8"/>` +
    arrowHead({ x: 304, y: y - 2 }, { x: 296, y: y - 8 }, ACCENT);
  return (
    item(48, valley, "谷折（自正面）") +
    item(160, mountain, "山折（自正面）") +
    `<g>${arrow}</g>` +
    text(316, y + 4, "折叠方向 · 按真实折轴生成", 9, MUTED) +
    text(PAGE.w - PAGE.margin, y + 4, "自背面观察时山/谷互换，页内已标注", 9, FAINT, "end")
  );
}

function stepBand(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan | CutawayPagePlan) {
  const step = snap.steps[p.stepIndex]!;
  const total = snap.steps.length;
  const partTag = p.parts > 1 ? ` · 第 ${p.part}/${p.parts} 部分` : "";
  const y = BAND.step.y;
  const noChange = "noChange" in p && p.noChange;
  return (
    `<rect x="${PAGE.margin}" y="${y}" width="86" height="52" rx="8" fill="${INK}"/>` +
    text(PAGE.margin + 43, y + 24, "步骤", 10, "#c9d2c4", "middle") +
    text(PAGE.margin + 43, y + 42, `${pad(p.stepIndex + 1)}/${pad(total)}`, 14, "#fff", "middle", SANS, 600) +
    text(PAGE.margin + 102, y + 24, step.title + partTag, 17, INK, "start", SERIF, 600) +
    text(PAGE.margin + 102, y + 46, clip(step.note, 52), 10.5, MUTED) +
    (noChange
      ? `<rect x="${PAGE.w - PAGE.margin - 132}" y="${y + 8}" width="132" height="24" rx="12" fill="#f0eee4" stroke="${PANEL_LINE}"/>` +
        text(PAGE.w - PAGE.margin - 66, y + 24, "本步形态无变化", 9.5, MUTED, "middle")
      : "")
  );
}

/** 展开图：整纸平铺，全部折痕编号，当前步骤折痕高亮并给出真实转向箭头 */
function cpPanel(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan) {
  const { paper } = snap;
  const proj = makeProjector(
    { yaw: 0, pitch: 90 },
    plan.cpScale,
    BAND.cp.x + BAND.cp.w / 2,
    BAND.cp.y + BAND.cp.h / 2 + 12,
    plan.cpCenter,
  );
  const hinges = hingePositions(paper, plan.flatPose);
  const hot = new Map(p.group.map((g) => [g.creaseId, g.delta]));
  let s = panelFrame(BAND.cp, "展开图 · 折痕编号", "正面朝上");
  s += `<g>${plan.flatPose
    .map((f) => {
      const pts = f.points.map((q) => {
        const v = proj(q);
        return `${num(v.x)},${num(v.y)}`;
      }).join(" ");
      return `<polygon points="${pts}" fill="${snap.front}" stroke="#785945" stroke-opacity=".35" stroke-width="1.1" stroke-linejoin="round"/>`;
    })
    .join("")}</g>`;
  paper.creases.forEach((c, i) => {
    const h = hinges.find((x) => x.id === c.id)!;
    const a = proj(h.a),
      b = proj(h.b);
    const delta = hot.get(c.id);
    const isHot = delta !== undefined;
    const kind = foldKind(paper, c.id, snap.steps[p.stepIndex]!.angles[c.id] ?? 0);
    const dash = isHot ? DASH[kind] : "5 4";
    s += `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke="${isHot ? ACCENT : LINE}" stroke-width="${isHot ? 2.4 : 1.2}" stroke-dasharray="${dash}"/>`;
    const movingFace = plan.flatPose.find((f) => f.id === c.face)!;
    const away = proj(centroid(movingFace.points));
    const spot = labelSpots(a, b, away);
    s += badge(spot.badge.x, spot.badge.y, i + 1, isHot);
    if (isHot) {
      const arc = arrowArc(paper, plan.flatPose, c.id, Math.sign(delta) * 75, 10);
      if (arc) s += arcSvg(arc.points, proj, ACCENT, 2, kind === "mountain" ? "5 4" : "");
      s += text(spot.kind.x, spot.kind.y, kind === "valley" ? "谷折" : kind === "mountain" ? "山折" : "平", 9.5, ACCENT, "middle", SANS, 600, true);
    }
  });
  return s;
}

/** 折叠视图：统一比例，ghost 为折叠前位置，箭头由真实折轴与转角采样 */
function foldedPanel(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan) {
  const { paper } = snap;
  const view = p.view ?? {
    yaw: -35,
    pitch: 50,
    label: "立体视角",
    backside: false,
    cutaway: false,
    hingeLen: 0,
    visibleRatio: 1,
  };
  const pose = plan.poses[p.stepIndex]!;
  const before = plan.poses[p.stepIndex - 1] ?? plan.flatPose;
  const proj = makeProjector(
    view,
    plan.foldedScale,
    BAND.folded.x + BAND.folded.w / 2,
    BAND.folded.y + BAND.folded.h / 2 + 12,
    plan.centers[p.stepIndex]!,
  );
  const moving = new Set<string>();
  for (const g of p.group) {
    const c = paper.creases.find((x) => x.id === g.creaseId)!;
    for (const id of movingSet(paper, c.face)) moving.add(id);
  }
  const hinges = hingePositions(paper, pose);
  const hot = new Map(p.group.map((g) => [g.creaseId, g.delta]));
  /** 山/谷按各折痕基面的实际朝向换算，而不是用全局视角近似 */
  const seesBack = (creaseId: string) => {
    const c = paper.creases.find((x) => x.id === creaseId)!;
    const face = paper.faces.find((f) => f.id === c.face)!;
    const base = pose.find((f) => f.id === (face.parent ?? c.face))!;
    return toCamera(base.normal, view)[2] > 0;
  };
  let s = panelFrame(
    BAND.folded,
    "折叠后 · " + view.label,
    view.backside ? "背面观察" : "",
  );
  if (moving.size) s += ghostSvg(before, moving, proj);
  s += facesSvg(pose, proj, view, snap.front, snap.back);
  paper.creases.forEach((c, i) => {
    const h = hinges.find((x) => x.id === c.id)!;
    const a = proj(h.a),
      b = proj(h.b);
    const isHot = hot.has(c.id);
    s += `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke="${isHot ? ACCENT : LINE}" stroke-width="${isHot ? 2.4 : 1.1}" stroke-dasharray="${isHot ? "none" : "5 4"}" stroke-opacity="${isHot ? 1 : 0.75}"/>`;
    if (isHot) {
      const movingFace = pose.find((f) => f.id === c.face)!;
      const spot = labelSpots(a, b, proj(centroid(movingFace.points)));
      s += badge(spot.badge.x, spot.badge.y, i + 1, true);
      const kind = foldKind(paper, c.id, snap.steps[p.stepIndex]!.angles[c.id] ?? 0);
      const back = seesBack(c.id);
      const shown =
        kind === "flat" ? "平" : back
          ? kind === "valley" ? "山折" : "谷折"
          : kind === "valley" ? "谷折" : "山折";
      s += text(spot.kind.x, spot.kind.y, shown + (back && kind !== "flat" ? "（背面看）" : ""), 9.5, ACCENT, "middle", SANS, 600, true);
    }
  });
  for (const g of p.group) {
    const arc = arrowArc(paper, before, g.creaseId, g.delta);
    if (!arc) continue;
    s += arcSvg(arc.points, proj, ACCENT, 2.2);
    const pts = arc.points.map(proj);
    const tip = pts[pts.length - 1]!,
      prev = pts[pts.length - 2]!;
    const tl = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    s += text(
      tip.x + ((tip.x - prev.x) / tl) * 14,
      tip.y + ((tip.y - prev.y) / tl) * 14,
      `${g.delta > 0 ? "+" : ""}${Math.round(g.delta)}°`,
      9.5,
      ACCENT,
      "middle",
      SANS,
      600,
      true,
    );
  }
  const notes: string[] = [];
  if (p.view && p.view.label !== "立体视角")
    notes.push(p.view.cutaway ? "各视角下动作均被遮挡或严重缩短，已选最佳视角并附剖面" : `为看清动作已切换至${p.view.label}`);
  if (view.backside) notes.push("自背面观察：山/谷观感与正面相反，标签已换算");
  notes.forEach((n, i) => {
    s += text(BAND.folded.x + 14, BAND.folded.y + BAND.folded.h - 30 + i * 14, clip(n, 30), 9, FAINT);
  });
  return s;
}

/** 局部放大：同一模型同一视角，仅放大折轴区域，保持真实几何 */
function insetPanel(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan, pageNo: number) {
  if (!p.inset || !p.view) return "";
  const { paper } = snap;
  const pose = plan.poses[p.stepIndex]!;
  const before = plan.poses[p.stepIndex - 1] ?? plan.flatPose;
  const hinge = hingePositions(paper, pose).find((h) => h.id === p.inset!.creaseId)!;
  const center: Vec3 = [(hinge.a[0] + hinge.b[0]) / 2, (hinge.a[1] + hinge.b[1]) / 2, (hinge.a[2] + hinge.b[2]) / 2];
  const box = { x: BAND.secondary.x, y: BAND.secondary.y, w: 330, h: BAND.secondary.h };
  const proj = makeProjector(p.view, plan.foldedScale * p.inset.zoom, box.x + box.w / 2, box.y + box.h / 2 + 6, center);
  const clipId = `inset-${pageNo}`;
  const g = p.group.find((x) => x.creaseId === p.inset!.creaseId)!;
  const arc = arrowArc(paper, before, g.creaseId, g.delta);
  const idx = paper.creases.findIndex((c) => c.id === g.creaseId);
  const moving = movingSet(paper, paper.creases.find((c) => c.id === g.creaseId)!.face);
  let inner = ghostSvg(before, moving, proj);
  inner += facesSvg(pose, proj, p.view, snap.front, snap.back);
  const a = proj(hinge.a),
    b = proj(hinge.b);
  inner += `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" stroke="${ACCENT}" stroke-width="2.6"/>`;
  if (arc) inner += arcSvg(arc.points, proj, ACCENT, 2.4);
  return (
    panelFrame(box, `局部放大 ×${num(p.inset.zoom)}`, `折痕 ${circled(idx + 1)}`) +
    `<clipPath id="${clipId}"><rect x="${box.x + 8}" y="${box.y + 34}" width="${box.w - 16}" height="${box.h - 46}" rx="6"/></clipPath>` +
    `<g clip-path="url(#${clipId})">${inner}</g>` +
    `<rect x="${box.x + 8}" y="${box.y + 34}" width="${box.w - 16}" height="${box.h - 46}" rx="6" fill="none" stroke="${PANEL_LINE}"/>`
  );
}

/** 剖面示意：沿折轴剖开，视线沿折轴方向，角度为真实转角 */
function cutawaySvg(
  snap: ManualSnapshot,
  plan: ManualPlan,
  stepIndex: number,
  creaseId: string,
  delta: number,
  box: { x: number; y: number; w: number; h: number },
) {
  const data = sectionData(snap.paper, plan.poses[stepIndex - 1] ?? plan.flatPose, creaseId, delta);
  const idx = snap.paper.creases.findIndex((c) => c.id === creaseId);
  let s = panelFrame(box, `剖面示意 · 折痕 ${circled(idx + 1)}`, "沿折轴剖开");
  if (!data) return s + text(box.x + 20, box.y + 60, "无法生成剖面", 10, MUTED);
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2 + 10,
    L = Math.min(box.h, box.w) * 0.36;
  const pt = (d: [number, number]) => ({ x: cx + d[0] * L, y: cy - d[1] * L });
  const base = pt(data.baseDir),
    before = pt(data.beforeDir),
    after = pt(data.afterDir);
  s += `<line x1="${num(cx)}" y1="${num(cy)}" x2="${num(base.x)}" y2="${num(base.y)}" stroke="${INK}" stroke-width="2.4"/>`;
  s += `<line x1="${num(cx)}" y1="${num(cy)}" x2="${num(before.x)}" y2="${num(before.y)}" stroke="${MUTED}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  s += `<line x1="${num(cx)}" y1="${num(cy)}" x2="${num(after.x)}" y2="${num(after.y)}" stroke="${ACCENT}" stroke-width="2.4"/>`;
  const a0 = Math.atan2(-data.beforeDir[1], data.beforeDir[0]);
  const arcPts: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const a = a0 + ((delta * Math.PI) / 180) * (i / 16);
    arcPts.push([cx + Math.cos(a) * L * 0.55, cy - Math.sin(a) * L * 0.55]);
  }
  s += `<path d="${arcPts.map((q, i) => `${i ? "L" : "M"}${num(q[0])} ${num(q[1])}`).join("")}" fill="none" stroke="${ACCENT}" stroke-width="1.8"/>`;
  s += arrowHead({ x: arcPts[16]![0], y: arcPts[16]![1] }, { x: arcPts[15]![0], y: arcPts[15]![1] }, ACCENT);
  s += `<circle cx="${num(cx)}" cy="${num(cy)}" r="4" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`;
  s += text(cx, cy + 18, "折轴", 8.5, MUTED, "middle");
  s += text(base.x + 4, base.y + 4, "基面", 9, MUTED);
  s += text(before.x - 2, before.y - 6, "折叠前", 9, MUTED, "end");
  s += text(after.x + 4, after.y - 4, `折叠后 ${delta > 0 ? "+" : ""}${Math.round(delta)}°`, 9, ACCENT, "start", SANS, 600);
  return s;
}

function notesPanel(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan, x: number, w: number) {
  const box = { x, y: BAND.secondary.y, w, h: BAND.secondary.h };
  const lines: string[] = [];
  if (p.noChange) lines.push("本步与上一步形态相同，页面保留用于确认形态与编号。");
  if (p.parts > 1) lines.push(`本步骤动作较多，已分 ${p.parts} 页排版，本页为第 ${p.part} 部分。`);
  if (p.view?.cutaway) lines.push("折叠动作在立体视图中被遮挡或缩短严重：已自动调整视角，并附剖面示意（角度为真实转角）。");
  else if (p.inset) lines.push("折轴在统一比例下过小，已附局部放大以保持真实尺寸细节。");
  if (p.view?.backside) lines.push("本页自纸张背面观察：山折与谷折观感互换，标签已按观察面换算。");
  if (!lines.length) lines.push("按箭头方向完成折叠，虚线为折叠前位置。");
  let s = panelFrame(box, "说明", "");
  lines.slice(0, 6).forEach((l, i) => {
    s += text(box.x + 16, box.y + 52 + i * 20, clip(l, 34), 10, MUTED);
  });
  return s;
}

function secondary(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan, pageNo: number) {
  const right = { x: BAND.secondary.x + 352, w: BAND.secondary.w - 352 };
  if (p.inset)
    return insetPanel(snap, plan, p, pageNo) + notesPanel(snap, plan, p, right.x, right.w);
  if (p.cutaway)
    return (
      cutawaySvg(snap, plan, p.stepIndex, p.cutaway.creaseId, p.cutaway.delta, {
        x: BAND.secondary.x,
        y: BAND.secondary.y,
        w: 330,
        h: BAND.secondary.h,
      }) + notesPanel(snap, plan, p, right.x, right.w)
    );
  return notesPanel(snap, plan, p, BAND.secondary.x, BAND.secondary.w);
}

function stepIdentity(snap: ManualSnapshot, p: StepPagePlan | CutawayPagePlan) {
  const step = snap.steps[p.stepIndex]!;
  return `步骤 ${pad(p.stepIndex + 1)} · ${step.title}${p.parts > 1 ? ` · ${p.part}/${p.parts}` : ""}`;
}

function stepPage(snap: ManualSnapshot, plan: ManualPlan, p: StepPagePlan, pageNo: number, total: number) {
  return (
    header(snap) +
    stepBand(snap, plan, p) +
    cpPanel(snap, plan, p) +
    foldedPanel(snap, plan, p) +
    secondary(snap, plan, p, pageNo) +
    legendStrip() +
    footer(snap, pageNo, total, stepIdentity(snap, p))
  );
}

function cutawayPage(snap: ManualSnapshot, plan: ManualPlan, p: CutawayPagePlan, pageNo: number, total: number) {
  const box = { x: BAND.cp.x, y: BAND.cp.y, w: BAND.cp.w + BAND.folded.w + 26, h: BAND.cp.h };
  return (
    header(snap) +
    stepBand(snap, plan, p) +
    cutawaySvg(snap, plan, p.stepIndex, p.cutaway.creaseId, p.cutaway.delta, box) +
    text(BAND.secondary.x, BAND.secondary.y + 20, "本页为剖面补充页：折叠动作在立体视图中被遮挡，剖面沿折轴方向观察，角度为真实转角。", 10, MUTED) +
    legendStrip() +
    footer(snap, pageNo, total, stepIdentity(snap, p) + " · 剖面")
  );
}

function cover(snap: ManualSnapshot, plan: ManualPlan, pageNo: number, total: number) {
  const { paper } = snap;
  const finalAngles = snap.steps[snap.steps.length - 1]?.angles ?? {};
  let s = header(snap);
  s += text(PAGE.margin, 168, "折叠说明书", 34, INK, "start", SERIF, 600);
  s += text(PAGE.margin, 202, `${paper.name} · ${paper.subtitle}`, 13, MUTED);
  s += text(PAGE.margin, 226, `共 ${total} 页 · ${snap.steps.length} 个步骤 · ${paper.creases.length} 道折痕`, 10.5, FAINT);
  const sw = (x: number, color: string, label: string) =>
    `<rect x="${x}" y="246" width="14" height="14" rx="3" fill="${color}" stroke="${PANEL_LINE}"/>` +
    text(x + 20, 257, label, 10, MUTED);
  s += sw(PAGE.margin, snap.front, "正面") + sw(PAGE.margin + 76, snap.back, "背面");
  let y = 300;
  s += `<rect x="${PAGE.margin}" y="${y}" width="${PAGE.w - PAGE.margin * 2}" height="${46 + paper.creases.length * 30}" rx="10" fill="${PANEL_BG}" stroke="${PANEL_LINE}"/>`;
  s += text(PAGE.margin + 16, y + 28, "折痕索引（编号全册一致）", 11, MUTED, "start", SANS, 600);
  paper.creases.forEach((c, i) => {
    const ry = y + 56 + i * 30;
    const kind = foldKind(paper, c.id, finalAngles[c.id] ?? 0);
    s += badge(PAGE.margin + 26, ry - 4, i + 1, false);
    s += text(PAGE.margin + 46, ry, c.name, 11, INK, "start", SANS, 600);
    s += text(PAGE.margin + 220, ry, clip(c.description, 26), 9.5, MUTED);
    s += text(PAGE.w - PAGE.margin - 16, ry, `${Math.round(finalAngles[c.id] ?? 0)}° · ${kind === "valley" ? "谷折" : kind === "mountain" ? "山折" : "平"}`, 10, kind === "flat" ? FAINT : ACCENT, "end", SANS, 600);
  });
  y += 46 + paper.creases.length * 30 + 26;
  s += `<rect x="${PAGE.margin}" y="${y}" width="${PAGE.w - PAGE.margin * 2}" height="150" rx="10" fill="${PANEL_BG}" stroke="${PANEL_LINE}"/>`;
  s += text(PAGE.margin + 16, y + 28, "图例", 11, MUTED, "start", SANS, 600);
  const ly = y + 62;
  s += `<line x1="${PAGE.margin + 16}" y1="${ly}" x2="${PAGE.margin + 60}" y2="${ly}" stroke="${LINE}" stroke-width="1.8" stroke-dasharray="${DASH.valley}"/>`;
  s += text(PAGE.margin + 70, ly + 4, "谷折 · 向观察者折起（自正面）", 10, MUTED);
  s += `<line x1="${PAGE.margin + 16}" y1="${ly + 30}" x2="${PAGE.margin + 60}" y2="${ly + 30}" stroke="${LINE}" stroke-width="1.8" stroke-dasharray="${DASH.mountain}"/>`;
  s += text(PAGE.margin + 70, ly + 34, "山折 · 向背面折去（自正面）", 10, MUTED);
  s += `<path d="M${PAGE.margin + 300} ${ly + 8} Q ${PAGE.margin + 322} ${ly - 16} ${PAGE.margin + 340} ${ly - 2}" fill="none" stroke="${ACCENT}" stroke-width="2"/>`;
  s += arrowHead({ x: PAGE.margin + 340, y: ly - 2 }, { x: PAGE.margin + 330, y: ly - 9 }, ACCENT);
  s += text(PAGE.margin + 352, ly + 4, "折叠方向 · 由真实折轴与转角生成", 10, MUTED);
  s += `<polygon points="${PAGE.margin + 306},${ly + 44} ${PAGE.margin + 334},${ly + 36} ${PAGE.margin + 338},${ly + 52}" fill="${INK}" fill-opacity=".06" stroke="${MUTED}" stroke-dasharray="4 3"/>`;
  s += text(PAGE.margin + 352, ly + 48, "折叠前位置（虚线）", 10, MUTED);
  s += text(PAGE.margin + 16, ly + 78, "自背面观察的步骤页已标注“背面观察”，其山/谷标签按观察面换算；被遮挡的动作附剖面示意。", 9.5, FAINT);
  s += footer(snap, pageNo, total, "封面");
  return s;
}

export function renderPage(
  snap: ManualSnapshot,
  plan: ManualPlan,
  pageNo: number,
): string {
  const total = plan.pages.length;
  const p = plan.pages[pageNo - 1]!;
  const body =
    p.kind === "cover"
      ? cover(snap, plan, pageNo, total)
      : p.kind === "step"
        ? stepPage(snap, plan, p, pageNo, total)
        : cutawayPage(snap, plan, p, pageNo, total);
  return `<svg viewBox="0 0 ${PAGE.w} ${PAGE.h}" width="${PAGE.w}" height="${PAGE.h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="说明书第 ${pageNo} 页"><rect width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>${body}</svg>`;
}
