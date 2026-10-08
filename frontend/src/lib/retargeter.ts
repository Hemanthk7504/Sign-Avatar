import * as THREE from "three";

// ─── 1. ONE EURO FILTER (Casiez et al., CHI 2012) ───────────────────────────
export class OneEuroFilter {
  freq: number;
  minCutoff: number;
  beta: number;
  dCutoff: number;
  xPrev: number | null = null;
  dxPrev: number = 0.0;
  tPrev: number | null = null;

  constructor(freq = 25, minCutoff = 1.2, beta = 0.015, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x: number, t?: number): number {
    if (this.xPrev === null || t === undefined || this.tPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0.0;
      this.tPrev = t || (typeof performance !== "undefined" ? performance.now() * 0.001 : 0);
      return x;
    }

    const dt = Math.max(t - this.tPrev, 1e-4);
    this.tPrev = t;

    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1.0 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    const fc = this.minCutoff + this.beta * Math.abs(dxHat);
    const aX = this.alpha(fc, dt);
    const xHat = aX * x + (1.0 - aX) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0.0;
    this.tPrev = null;
  }
}

export class LandmarkFilterBank {
  filters: { x: OneEuroFilter; y: OneEuroFilter; z: OneEuroFilter }[] = [];

  constructor(n = 66) {
    for (let i = 0; i < n; i++) {
      this.filters.push({
        x: new OneEuroFilter(),
        y: new OneEuroFilter(),
        z: new OneEuroFilter(),
      });
    }
  }

  smooth(pts: number[][], t?: number): (number[] | null)[] {
    const ts = t || (typeof performance !== "undefined" ? performance.now() * 0.001 : 0);
    return pts.map((p, i) => {
      if (!p || isNaN(p[0]) || isNaN(p[1]) || isNaN(p[2]) || Math.abs(p[0]) > 400) {
        return null;
      }
      let f = this.filters[i];
      if (!f) {
        f = {
          x: new OneEuroFilter(),
          y: new OneEuroFilter(),
          z: new OneEuroFilter(),
        };
        this.filters[i] = f;
      }
      return [f.x.filter(p[0], ts), f.y.filter(p[1], ts), f.z.filter(p[2], ts)];
    });
  }

  reset(): void {
    this.filters.forEach((f) => {
      f.x.reset();
      f.y.reset();
      f.z.reset();
    });
  }
}

// ─── 2. PARENT-RELATIVE SWING-TWIST RETARGETER ──────────────────────────────
export interface PivotMap {
  [name: string]: THREE.Group;
}

export interface MorphTargetMap {
  [name: string]: THREE.Mesh;
}

export class AnatomicalRetargeter {
  pivots: PivotMap;
  morphs: MorphTargetMap;
  filterBank: LandmarkFilterBank;
  private occDur: Record<string, number> = {};
  private lastQ: Record<string, THREE.Quaternion> = {};
  private restQ: Record<string, THREE.Quaternion> = {};

  constructor(pivots: PivotMap, morphs: MorphTargetMap = {}) {
    this.pivots = pivots;
    this.morphs = morphs;
    this.filterBank = new LandmarkFilterBank(66);

    for (const [name, pivot] of Object.entries(pivots)) {
      this.occDur[name] = 0;
      this.lastQ[name] = pivot.quaternion.clone();
      this.restQ[name] = pivot.quaternion.clone();
    }
  }

  retarget(rawPts: number[][], dt: number): void {
    if (!rawPts || rawPts.length < 8) return;
    const pts = this.filterBank.smooth(rawPts);

    const ls = pts[0], rs = pts[1];
    const le = pts[2], re = pts[3];
    const lw = pts[4], rw = pts[5];

    // Spine & Torso balance
    this.solveSpine(ls, rs, dt);

    // Arm kinematics (swing-twist vector solver)
    this.solveSegment("left_arm", ls, le, dt);
    this.solveSegment("left_forearm", le, lw, dt);
    this.solveSegment("right_arm", rs, re, dt);
    this.solveSegment("right_forearm", re, rw, dt);

    // Articulated 5-digit hands
    if (pts.length >= 50) {
      this.solveHand("left", pts.slice(8, 29), lw, dt);
      this.solveHand("right", pts.slice(29, 50), rw, dt);
    }

    // Facial non-manual markers & head pose
    if (pts.length >= 66) {
      this.solveFace(pts.slice(50, 66), dt);
    }
  }

  private isValid(p: number[] | null | undefined): p is number[] {
    return !!p && !isNaN(p[0]) && !isNaN(p[1]) && Math.abs(p[0]) < 200;
  }

  private solveSegment(
    boneName: string,
    pProx: number[] | null | undefined,
    pDist: number[] | null | undefined,
    dt: number
  ): void {
    const pivot = this.pivots[boneName];
    if (!pivot) return;

    if (!this.isValid(pProx) || !this.isValid(pDist)) {
      this.handleOcclusion(boneName, pivot, dt);
      return;
    }
    this.occDur[boneName] = 0;

    const dirWorld = new THREE.Vector3(
      pDist[0] - pProx[0],
      pDist[1] - pProx[1],
      pDist[2] - pProx[2]
    );
    if (dirWorld.lengthSq() < 1e-6) return;
    dirWorld.normalize();

    const parentQ = new THREE.Quaternion();
    if (pivot.parent) pivot.parent.getWorldQuaternion(parentQ);
    const dirLocal = dirWorld.clone().applyQuaternion(parentQ.clone().invert()).normalize();

    // Limbs hang along -Y in bind pose
    const bindAxis = new THREE.Vector3(0, -1, 0);
    const targetQ = new THREE.Quaternion().setFromUnitVectors(bindAxis, dirLocal);

    const alpha = 1.0 - Math.exp(-dt * 24.0);
    pivot.quaternion.slerp(targetQ, alpha);
    this.lastQ[boneName].copy(pivot.quaternion);
  }

  private solveSpine(
    ls: number[] | null | undefined,
    rs: number[] | null | undefined,
    dt: number
  ): void {
    const spine = this.pivots["spine"];
    if (!spine || !this.isValid(ls) || !this.isValid(rs)) return;

    const midX = (ls[0] + rs[0]) * 0.5;
    const midY = (ls[1] + rs[1]) * 0.5;
    const rollZ = THREE.MathUtils.clamp(-midX * 0.35, -0.2, 0.2);
    const pitchX = THREE.MathUtils.clamp(-midY * 0.15, -0.12, 0.12);

    const targetQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(pitchX, 0, rollZ, "YXZ")
    );
    spine.quaternion.slerp(targetQ, 1.0 - Math.exp(-dt * 8.0));
  }

  private solveHand(
    side: "left" | "right",
    hPts: (number[] | null)[],
    wristPos: number[] | null | undefined,
    dt: number
  ): void {
    if (!hPts || hPts.length < 21) return;

    const wristPt = hPts[0];
    const indexMcp = hPts[5];

    // Wrist orientation
    const handPivot = this.pivots[`${side}_hand`];
    if (handPivot && this.isValid(wristPt) && this.isValid(indexMcp)) {
      const vPalm = new THREE.Vector3(
        indexMcp[0] - wristPt[0],
        indexMcp[1] - wristPt[1],
        indexMcp[2] - wristPt[2]
      );
      if (vPalm.lengthSq() > 1e-6) {
        vPalm.normalize();
        const parentQ = new THREE.Quaternion();
        if (handPivot.parent) handPivot.parent.getWorldQuaternion(parentQ);
        const dirLocal = vPalm.applyQuaternion(parentQ.clone().invert()).normalize();
        const targetQ = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, -1, 0),
          dirLocal
        );

        handPivot.quaternion.slerp(targetQ, 1.0 - Math.exp(-dt * 20.0));
        this.lastQ[`${side}_hand`].copy(handPivot.quaternion);
        this.occDur[`${side}_hand`] = 0;
      }
    }

    // 5 Fingers
    const digits = ["thumb", "index", "middle", "ring", "pinky"];
    const indices = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ];

    for (let d = 0; d < 5; d++) {
      for (let ph = 1; ph <= 3; ph++) {
        const p0 = hPts[indices[d][ph - 1]];
        const p1 = hPts[indices[d][ph]];
        const boneName = `${side}_${digits[d]}_${ph}`;
        const pivot = this.pivots[boneName];
        if (!pivot) continue;

        if (!this.isValid(p0) || !this.isValid(p1)) {
          this.handleOcclusion(boneName, pivot, dt);
          continue;
        }
        this.occDur[boneName] = 0;

        const vBone = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
        if (vBone.lengthSq() < 1e-6) continue;
        vBone.normalize();

        const parentQ = new THREE.Quaternion();
        if (pivot.parent) pivot.parent.getWorldQuaternion(parentQ);
        const dirLocal = vBone.applyQuaternion(parentQ.clone().invert()).normalize();
        const targetQ = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, -1, 0),
          dirLocal
        );

        pivot.quaternion.slerp(targetQ, 1.0 - Math.exp(-dt * 24.0));
        this.lastQ[boneName].copy(pivot.quaternion);
      }
    }
  }

  private solveFace(fPts: (number[] | null)[], dt: number): void {
    if (!fPts || fPts.length < 16) return;

    const head = this.pivots["head"];
    const leftEye = fPts[4];
    const rightEye = fPts[0];
    const nose = fPts[8];

    // 3-DOF Head Pose
    if (head && this.isValid(leftEye) && this.isValid(rightEye) && this.isValid(nose)) {
      const eyeSpan = new THREE.Vector2(leftEye[0] - rightEye[0], leftEye[1] - rightEye[1]);
      const midEyeX = (leftEye[0] + rightEye[0]) * 0.5;
      const midEyeY = (leftEye[1] + rightEye[1]) * 0.5;

      const roll = Math.atan2(eyeSpan.y, eyeSpan.x);
      const yaw = THREE.MathUtils.clamp((nose[0] - midEyeX) * 3.2, -0.55, 0.55);
      const pitch = THREE.MathUtils.clamp((midEyeY - nose[1] - 0.04) * 2.8, -0.42, 0.42);

      const targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(pitch, yaw, roll, "YXZ")
      );
      head.quaternion.slerp(targetQ, 1.0 - Math.exp(-dt * 14.0));
    }

    // Eyebrows
    const browL = this.morphs.browL;
    const browR = this.morphs.browR;
    const lb = fPts[6], rb = fPts[2];
    if (browL && browR && this.isValid(lb) && this.isValid(rb)) {
      const avgY = (lb[1] + rb[1]) * 0.5;
      const browUp = THREE.MathUtils.clamp((avgY - 0.13) * 4.5, 0, 1);
      const browDown = THREE.MathUtils.clamp((0.13 - avgY) * 4.5, 0, 1);

      const yOffset = 0.090 + browUp * 0.016 - browDown * 0.012;
      browL.position.y = yOffset;
      browR.position.y = yOffset;
      browL.rotation.z = 0.08 + browDown * 0.22;
      browR.rotation.z = -0.08 - browDown * 0.22;
    }

    // Mouth Opening
    const lowerLip = this.morphs.lowerLip;
    const upperLip = fPts[12], ll = fPts[14];
    if (lowerLip && this.isValid(upperLip) && this.isValid(ll)) {
      const dist = Math.hypot(upperLip[0] - ll[0], upperLip[1] - ll[1]);
      const open = THREE.MathUtils.clamp((dist - 0.012) * 8.0, 0, 1);
      lowerLip.position.y = -0.014 - open * 0.018;
    }
  }

  private handleOcclusion(boneName: string, pivot: THREE.Group, dt: number): void {
    this.occDur[boneName] = (this.occDur[boneName] || 0) + dt;
    if (this.occDur[boneName] <= 0.2) {
      pivot.quaternion.copy(this.lastQ[boneName]);
    } else {
      pivot.quaternion.slerp(this.restQ[boneName], 1.0 - Math.exp(-dt * 2.8));
      this.lastQ[boneName].copy(pivot.quaternion);
    }
  }
}
