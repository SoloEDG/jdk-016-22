import type { Paper, PoseFace, Vec3, View } from "../../../shared/types";
import { cameraPoint } from "../../observe/lib/projection";
import { cross, dot, scale, sub, unit, rotate, add } from "../../../shared/vector";

export interface Projected {
  x: number;
  y: number;
  z: number;
}
export type Projector = (p: Vec3) => Projected;

/** cameraPoint 只读取 yaw/pitch，这里收敛类型转换 */
export const toCamera = (
  p: Vec3,
  view: Pick<View, "yaw" | "pitch">,
): Vec3 => cameraPoint(p, view as View);

/** 与视口一致的投影（正交），但比例、中心可参数化，保证跨页比例统一 */
export function makeProjector(
  view: Pick<View, "yaw" | "pitch">,
  scale: number,
  cx: number,
  cy: number,
  center: Vec3,
): Projector {
  return (p) => {
    const c = toCamera(sub(p, center), view);
    return { x: cx + c[0] * scale, y: cy - c[1] * scale, z: c[2] };
  };
}

/** 观察方向（场景指向相机）的世界坐标 */
export function viewDirection(view: Pick<View, "yaw" | "pitch">): Vec3 {
  const a = (view.yaw * Math.PI) / 180,
    b = (view.pitch * Math.PI) / 180;
  return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
}

/** 折轴所带动的纸面集合：自身 + 所有后代面 */
export function movingSet(paper: Paper, faceId: string) {
  const set = new Set<string>([faceId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of paper.faces)
      if (f.parent && set.has(f.parent) && !set.has(f.id)) {
        set.add(f.id);
        grew = true;
      }
  }
  return set;
}

/** 相邻两步之间角度发生变化的折痕 */
export function changedCreases(
  paper: Paper,
  prev: Record<string, number>,
  next: Record<string, number>,
) {
  return paper.creases
    .filter((c) => Math.abs((next[c.id] ?? 0) - (prev[c.id] ?? 0)) > 0.5)
    .map((c) => ({ crease: c, delta: (next[c.id] ?? 0) - (prev[c.id] ?? 0) }));
}

export function centroid(points: Vec3[]): Vec3 {
  const s = points.reduce((acc, p) => add(acc, p), [0, 0, 0] as Vec3);
  return scale(s, 1 / points.length);
}

/**
 * 山/谷判定（相对纸张正面，即平展时 +Y 一侧）：
 * 取折轴指向自由边的向量，按实际角度旋转后向上则为谷折，向下为山折。
 */
export function foldKind(paper: Paper, creaseId: string, angle: number) {
  const crease = paper.creases.find((c) => c.id === creaseId);
  const face = paper.faces.find((f) => f.id === crease?.face);
  if (!crease || !face?.hinge || Math.abs(angle) < 0.5) return "flat" as const;
  const [a, b] = face.hinge;
  const k = unit(sub(b, a));
  const mid = scale(add(a, b), 0.5);
  const free =
    face.points
      .filter((p) => !onSegment(p, a, b))
      .sort((p, q) => distToAxis(q, a, k) - distToAxis(p, a, k))[0] ??
    face.points[0]!;
  const u = sub(free, mid);
  const turned = sub(rotate(add(mid, u), a, b, angle), mid);
  return turned[1] > 0.001
    ? ("valley" as const)
    : turned[1] < -0.001
      ? ("mountain" as const)
      : ("flat" as const);
}

function onSegment(p: Vec3, a: Vec3, b: Vec3) {
  return (
    Math.hypot(...sub(p, a)) + Math.hypot(...sub(p, b)) - Math.hypot(...sub(b, a)) <
    1e-9
  );
}
function distToAxis(p: Vec3, a: Vec3, k: Vec3) {
  const v = sub(p, a);
  return Math.hypot(...sub(v, scale(k, dot(v, k))));
}

/**
 * 方向箭头：把运动面上离折轴最远的点，绕真实折轴按实际转角采样成弧线。
 * 返回世界坐标采样点（含首尾），调用方投影后绘制。
 */
export function arrowArc(
  paper: Paper,
  poseBefore: PoseFace[],
  creaseId: string,
  delta: number,
  samples = 14,
): { points: Vec3[]; hinge: [Vec3, Vec3] } | null {
  const crease = paper.creases.find((c) => c.id === creaseId);
  const base = paper.faces.find((f) => f.id === crease?.face);
  const face = poseBefore.find((f) => f.id === crease?.face);
  if (!crease || !base?.hinge || !face) return null;
  const idx = base.hinge.map((h) =>
    base.points.findIndex((p) => p.every((n, i) => n === h[i])),
  );
  const a = face.points[idx[0]!]!,
    b = face.points[idx[1]!]!;
  const k = unit(sub(b, a));
  const free = face.points
    .filter((p) => !onSegment(p, a, b))
    .sort((p, q) => distToAxis(q, a, k) - distToAxis(p, a, k))[0];
  if (!free) return null;
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i++)
    points.push(rotate(free, a, b, (delta * i) / samples));
  return { points, hinge: [a, b] };
}

/** 点在指定视角下是否被其它纸面遮住（orthographic 深度比较） */
export function occluded(
  p: Vec3,
  faces: PoseFace[],
  view: Pick<View, "yaw" | "pitch">,
  ignore: Set<string>,
  project: Projector,
) {
  const probe = add(p, scale(viewDirection(view), 0.015));
  const pp = project(probe);
  for (const f of faces) {
    if (ignore.has(f.id)) continue;
    const tri = f.points.map(project);
    for (let i = 1; i + 1 < tri.length; i++) {
      const z = depthAt(tri[0]!, tri[i]!, tri[i + 1]!, pp);
      if (z !== null && z > pp.z + 1e-4) return true;
    }
  }
  return false;
}

/** 点在某三角形投影内的插值深度；不在三角形内返回 null */
function depthAt(a: Projected, b: Projected, c: Projected, p: Projected) {
  const d = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(d) < 1e-9) return null;
  const u = ((b.x - p.x) * (c.y - p.y) - (c.x - p.x) * (b.y - p.y)) / d,
    v = ((c.x - p.x) * (a.y - p.y) - (a.x - p.x) * (c.y - p.y)) / d,
    w = 1 - u - v;
  if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null;
  return u * a.z + v * b.z + w * c.z;
}

export interface ViewChoice {
  yaw: number;
  pitch: number;
  label: string;
  /** 从纸张背面一侧观察，山/谷需互换说明 */
  backside: boolean;
  /** 所有候选视角下动作仍被遮住，需要剖面补充 */
  cutaway: boolean;
  /** 折轴投影长度（用于决定是否局部放大） */
  hingeLen: number;
  visibleRatio: number;
}

const CANDIDATES = [
  { yaw: -35, pitch: 50, label: "立体视角" },
  { yaw: 35, pitch: 50, label: "立体视角 · 镜像" },
  { yaw: 0, pitch: 90, label: "俯视" },
  { yaw: 180, pitch: 50, label: "后方立体视角" },
  { yaw: 0, pitch: -60, label: "仰视" },
  { yaw: 0, pitch: 28, label: "正视" },
  { yaw: 45, pitch: 28, label: "右前视角" },
  { yaw: 90, pitch: 28, label: "右侧视角" },
  { yaw: 135, pitch: 28, label: "右后视角" },
  { yaw: 180, pitch: 28, label: "后方平视" },
  { yaw: -135, pitch: 28, label: "左后视角" },
  { yaw: -90, pitch: 28, label: "左侧视角" },
  { yaw: -45, pitch: 28, label: "左前视角" },
];

/** 弧线投影短于此比例时，立体视图不足以表达动作，附剖面示意 */
const MIN_LEGIBILITY = 0.45;

/**
 * 为一组折痕动作挑选视角：
 * 1. 动作弧线与折轴不能被其它纸面遮住（遮挡率评分）；
 * 2. 弧线投影长度要接近真实弧长（沿折轴看最清晰，缩短严重则换向）；
 * 全部候选都不理想时退化为最佳视角 + 剖面说明。
 */
export function chooseView(
  paper: Paper,
  poseAfter: PoseFace[],
  arcs: { points: Vec3[]; hinge: [Vec3, Vec3] }[],
  moving: Set<string>,
  scale: number,
  center: Vec3,
): ViewChoice {
  let best: ViewChoice | null = null;
  let bestScore = -Infinity;
  CANDIDATES.forEach((cand, order) => {
    const project = makeProjector(cand, scale, 0, 0, center);
    let visible = 0,
      total = 0,
      hingeLen = 0,
      projLen = 0,
      trueLen = 0;
    for (const arc of arcs) {
      for (let i = 0; i < arc.points.length; i++) {
        total++;
        if (!occluded(arc.points[i], poseAfter, cand, moving, project))
          visible++;
        if (i > 0) {
          const a = project(arc.points[i - 1]!),
            b = project(arc.points[i]!);
          projLen += Math.hypot(b.x - a.x, b.y - a.y);
          trueLen +=
            Math.hypot(
              arc.points[i]![0] - arc.points[i - 1]![0],
              arc.points[i]![1] - arc.points[i - 1]![1],
              arc.points[i]![2] - arc.points[i - 1]![2],
            ) * scale;
        }
      }
      const ha = project(arc.hinge[0]),
        hb = project(arc.hinge[1]);
      hingeLen = Math.max(hingeLen, Math.hypot(hb.x - ha.x, hb.y - ha.y));
    }
    const ratio = total ? visible / total : 1;
    const legibility = trueLen > 1 ? Math.min(1, projLen / trueLen) : 1;
    const score =
      ratio * 1000 + legibility * 420 + Math.min(hingeLen, 140) - order * 4;
    if (score > bestScore) {
      bestScore = score;
      best = {
        ...cand,
        backside: toCamera([0, -1, 0], cand)[2] > 0,
        cutaway: ratio < 0.85 || legibility < MIN_LEGIBILITY,
        hingeLen,
        visibleRatio: ratio,
      };
    }
  });
  return best!;
}

/**
 * 剖面图数据：沿折轴垂直面剖开，看向折轴方向。
 * 返回二维坐标（剖面内），基面方向固定为 +x。
 */
export function sectionData(
  paper: Paper,
  poseBefore: PoseFace[],
  creaseId: string,
  delta: number,
) {
  const crease = paper.creases.find((c) => c.id === creaseId);
  const base = paper.faces.find((f) => f.id === crease?.face);
  const face = poseBefore.find((f) => f.id === crease?.face);
  if (!crease || !base?.hinge || !face) return null;
  const idx = base.hinge.map((h) =>
    base.points.findIndex((p) => p.every((n, i) => n === h[i])),
  );
  const a = face.points[idx[0]!]!,
    b = face.points[idx[1]!]!;
  const k = unit(sub(b, a));
  const mid = scale(add(a, b), 0.5);
  const parentFace =
    poseBefore.find((f) => f.id === base.parent) ??
    poseBefore.find((f) => f.id !== face.id);
  if (!parentFace) return null;
  const flat = (v: Vec3) => sub(v, scale(k, dot(v, k)));
  const e1 = unit(flat(sub(centroid(parentFace.points), mid)));
  const e2 = unit(cross(k, e1));
  const moveDir = unit(flat(sub(centroid(face.points), mid)));
  const afterDir = sub(rotate(add(mid, moveDir), a, b, delta), mid);
  const to2d = (v: Vec3): [number, number] => [dot(v, e1), dot(v, e2)];
  return {
    baseDir: to2d(e1),
    beforeDir: to2d(moveDir),
    afterDir: to2d(afterDir),
    delta,
  };
}
