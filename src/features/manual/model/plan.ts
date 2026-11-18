import type { PoseFace, Vec3 } from "../../../shared/types";
import { solvePose } from "../../fold/lib/kinematics";
import { clamp } from "../../../shared/document";
import {
  arrowArc,
  centroid,
  changedCreases,
  chooseView,
  movingSet,
  type ViewChoice,
} from "../lib/diagram";
import { BAND, PANEL_PAD } from "../lib/layout";
import type { ManualSnapshot } from "./snapshot";

export interface CoverPlan {
  kind: "cover";
}
export interface StepPagePlan {
  kind: "step";
  stepIndex: number;
  /** 同一动作组被拆成多页时的页序（1 起） */
  part: number;
  parts: number;
  group: { creaseId: string; delta: number }[];
  noChange: boolean;
  view: ViewChoice | null;
  inset: { zoom: number; creaseId: string } | null;
  cutaway: { creaseId: string; delta: number } | null;
}
export interface CutawayPagePlan {
  kind: "cutaway";
  stepIndex: number;
  part: number;
  parts: number;
  cutaway: { creaseId: string; delta: number };
}
export type PagePlan = CoverPlan | StepPagePlan | CutawayPagePlan;

export interface ManualPlan {
  pages: PagePlan[];
  /** 全部折叠视图共用的比例（px / 模型单位），跨页一致 */
  foldedScale: number;
  /** 展开图共用的比例 */
  cpScale: number;
  cpCenter: Vec3;
  centers: Vec3[];
  poses: PoseFace[][];
  flatPose: PoseFace[];
  noChangeSteps: number[];
}

const GROUP_SIZE = 2;
/** 折轴投影短于此值时安排局部放大 */
const MIN_HINGE_PX = 64;

export function buildPlan(snapshot: ManualSnapshot): ManualPlan {
  const { paper, steps } = snapshot;
  const poses = steps.map((s) => solvePose(paper, s.angles));
  const flatPose = solvePose(paper, {});
  const centers = poses.map((pose) =>
    centroid(pose.flatMap((f) => f.points)),
  );
  const radius = Math.max(
    0.2,
    ...poses.map((pose, i) =>
      Math.max(
        ...pose.flatMap((f) =>
          f.points.map((p) =>
            Math.hypot(p[0] - centers[i]![0], p[1] - centers[i]![1], p[2] - centers[i]![2]),
          ),
        ),
      ),
    ),
  );
  const foldedScale =
    (Math.min(BAND.folded.w, BAND.folded.h) / 2 - PANEL_PAD) / radius;

  const xs = flatPose.flatMap((f) => f.points.map((p) => p[0])),
    zs = flatPose.flatMap((f) => f.points.map((p) => p[2]));
  const cpBox = {
    x: Math.min(...xs),
    z: Math.min(...zs),
    w: Math.max(...xs) - Math.min(...xs) || 1,
    d: Math.max(...zs) - Math.min(...zs) || 1,
  };
  const cpScale = Math.min(
    (BAND.cp.w - PANEL_PAD * 2) / cpBox.w,
    (BAND.cp.h - PANEL_PAD * 2) / cpBox.d,
  );
  const cpCenter: Vec3 = [cpBox.x + cpBox.w / 2, 0, cpBox.z + cpBox.d / 2];

  const pages: PagePlan[] = [{ kind: "cover" }];
  const noChangeSteps: number[] = [];

  steps.forEach((step, i) => {
    const prev = i > 0 ? steps[i - 1]!.angles : {};
    const changes = changedCreases(paper, prev, step.angles);
    if (!changes.length) {
      noChangeSteps.push(i);
      pages.push({
        kind: "step",
        stepIndex: i,
        part: 1,
        parts: 1,
        group: [],
        noChange: true,
        view: null,
        inset: null,
        cutaway: null,
      });
      return;
    }
    const groups: (typeof changes)[] = [];
    for (let g = 0; g < changes.length; g += GROUP_SIZE)
      groups.push(changes.slice(g, g + GROUP_SIZE));
    groups.forEach((group, gi) => {
      const moving = new Set<string>();
      const arcs = [];
      for (const { crease, delta } of group) {
        for (const id of movingSet(paper, crease.face)) moving.add(id);
        const arc = arrowArc(paper, poses[i - 1] ?? flatPose, crease.id, delta);
        if (arc) arcs.push(arc);
      }
      const view = chooseView(
        paper,
        poses[i]!,
        arcs,
        moving,
        foldedScale,
        centers[i]!,
      );
      const inset =
        view.hingeLen < MIN_HINGE_PX
          ? {
              zoom: clamp(80 / Math.max(view.hingeLen, 1), 1.5, 4),
              creaseId: group[0]!.crease.id,
            }
          : null;
      const cutaway = view.cutaway
        ? { creaseId: group[0]!.crease.id, delta: group[0]!.delta }
        : null;
      const part = gi + 1;
      pages.push({
        kind: "step",
        stepIndex: i,
        part,
        parts: groups.length,
        group: group.map(({ crease, delta }) => ({
          creaseId: crease.id,
          delta,
        })),
        noChange: false,
        view,
        inset,
        // 局部放大与剖面同页放不下时，剖面移到续页，保证版式可读
        cutaway: cutaway && !inset ? cutaway : null,
      });
      if (cutaway && inset)
        pages.push({
          kind: "cutaway",
          stepIndex: i,
          part,
          parts: groups.length,
          cutaway,
        });
    });
  });

  return {
    pages,
    foldedScale,
    cpScale,
    cpCenter,
    centers,
    poses,
    flatPose,
    noChangeSteps,
  };
}
