/**
 * SignAvatar Studio — Production Ready Player Me & Mixamo 3D Human Avatar
 *
 * Analytical Two-Bone IK, natural ready stance, and lifelike human micro-kinematics
 * with parent-relative swing-twist retargeting and One Euro temporal filtering.
 */

// ─── 1. ONE EURO FILTER (Casiez et al., CHI 2012) ───────────────────────────
class _OEF {
  constructor(fmin = 1.2, beta = 0.015, dc = 1.0) {
    this.fmin = fmin;
    this.beta = beta;
    this.dc = dc;
    this.xp = null;
    this.dxp = 0.0;
    this.tp = null;
  }

  _alpha(fc, dt) {
    const tau = 1.0 / (2.0 * Math.PI * fc);
    return 1.0 / (1.0 + tau / dt);
  }

  run(x, t) {
    if (this.xp === null || isNaN(x)) {
      this.xp = x;
      this.tp = t || performance.now() * 0.001;
      return x;
    }
    const dt = Math.max(t - this.tp, 1e-4);
    this.tp = t;
    const dx = (x - this.xp) / dt;
    const aD = this._alpha(this.dc, dt);
    const dxHat = aD * dx + (1.0 - aD) * this.dxp;
    this.dxp = dxHat;
    const fc = this.fmin + this.beta * Math.abs(dxHat);
    const aX = this._alpha(fc, dt);
    const xHat = aX * x + (1.0 - aX) * this.xp;
    this.xp = xHat;
    return xHat;
  }

  reset() {
    this.xp = null;
    this.dxp = 0.0;
    this.tp = null;
  }
}

class LandmarkFilterBank {
  constructor(n = 66) {
    this.n = n;
    this.filters = [];
    for (let i = 0; i < n; i++) {
      this.filters.push({ x: new _OEF(), y: new _OEF(), z: new _OEF() });
    }
  }

  smooth(pts, t) {
    const ts = t || performance.now() * 0.001;
    return pts.map((p, i) => {
      if (!p || isNaN(p[0]) || Math.abs(p[0]) > 400) return null;
      let f = this.filters[i];
      if (!f) {
        f = { x: new _OEF(), y: new _OEF(), z: new _OEF() };
        this.filters[i] = f;
      }
      return [f.x.run(p[0], ts), f.y.run(p[1], ts), f.z.run(p[2], ts)];
    });
  }

  reset() {
    this.filters.forEach((f) => {
      f.x.reset();
      f.y.reset();
      f.z.reset();
    });
  }
}
window.LandmarkFilterBank = LandmarkFilterBank;


// ─── 2. HUMANOID RETARGETER WITH TWO-BONE IK ────────────────────────────────
class AnatomicalRetargeter {
  constructor(avatarScene) {
    this.scene = avatarScene;
    this.filterBank = new LandmarkFilterBank(66);
    this.bones = {};
    this.bindWorldQ = {};
    this.uBindWorld = {};
    this.restLocalQ = {};
    this.restLocalPos = {};
    this.lastLocalQ = {};

    this.leftShoulderPos = new THREE.Vector3();
    this.rightShoulderPos = new THREE.Vector3();
    this.shoulderCenter = new THREE.Vector3(0, 1.48, -0.02);
    this.shoulderWidth = 0.332;

    this.upperArmLength = 0.285;
    this.forearmLength = 0.252;

    this.leftWristRest = new THREE.Vector3(0.12, 1.18, 0.26);
    this.rightWristRest = new THREE.Vector3(-0.12, 1.18, 0.26);

    this.currentLeftWrist = new THREE.Vector3(0.12, 1.18, 0.26);
    this.currentRightWrist = new THREE.Vector3(-0.12, 1.18, 0.26);

    // Forward-biased elbow pole vectors
    this.leftPole = new THREE.Vector3(0.70, -0.30, 0.25).normalize();
    this.rightPole = new THREE.Vector3(-0.70, -0.30, 0.25).normalize();

    this.headMesh = null;
    this.teethMesh = null;

    this._initBones();
  }

  _initBones() {
    this.scene.updateMatrixWorld(true);

    this.scene.traverse((obj) => {
      if (obj.isBone) {
        const cleanName = obj.name.replace(/^mixamorig:?/i, "");
        this.bones[cleanName] = obj;
        this.restLocalQ[cleanName] = obj.quaternion.clone();
        this.restLocalPos[cleanName] = obj.position.clone();
        this.lastLocalQ[cleanName] = obj.quaternion.clone();

        const worldQ = obj.getWorldQuaternion(new THREE.Quaternion());
        this.bindWorldQ[cleanName] = worldQ;
        this.uBindWorld[cleanName] = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ).normalize();
      }

      if (obj.isMesh) {
        if (obj.name === "Wolf3D_Head") this.headMesh = obj;
        if (obj.name === "Wolf3D_Teeth") this.teethMesh = obj;
      }
    });

    if (this.bones["LeftArm"]) {
      this.bones["LeftArm"].getWorldPosition(this.leftShoulderPos);
    }
    if (this.bones["RightArm"]) {
      this.bones["RightArm"].getWorldPosition(this.rightShoulderPos);
    }

    if (this.leftShoulderPos.lengthSq() > 0 && this.rightShoulderPos.lengthSq() > 0) {
      this.shoulderCenter.copy(this.leftShoulderPos).add(this.rightShoulderPos).multiplyScalar(0.5);
      this.shoulderWidth = Math.max(0.22, this.leftShoulderPos.distanceTo(this.rightShoulderPos));

      if (this.bones["LeftForeArm"] && this.bones["LeftHand"]) {
        const elbowP = new THREE.Vector3();
        const wristP = new THREE.Vector3();
        this.bones["LeftForeArm"].getWorldPosition(elbowP);
        this.bones["LeftHand"].getWorldPosition(wristP);
        this.upperArmLength = Math.max(0.20, this.leftShoulderPos.distanceTo(elbowP));
        this.forearmLength = Math.max(0.18, elbowP.distanceTo(wristP));
      }

      const totalArm = this.upperArmLength + this.forearmLength;

      // Natural SIDE-BY-SIDE resting position (down along the outer hips/thighs, NEVER on chest)
      this.leftWristRest.set(
        this.leftShoulderPos.x + 0.08,
        this.leftShoulderPos.y - totalArm * 0.90,
        this.leftShoulderPos.z + 0.04
      );
      this.rightWristRest.set(
        this.rightShoulderPos.x - 0.08,
        this.rightShoulderPos.y - totalArm * 0.90,
        this.rightShoulderPos.z + 0.04
      );
      this.currentLeftWrist.copy(this.leftWristRest);
      this.currentRightWrist.copy(this.rightWristRest);
    }

    this._applyReadyStance(0);
  }

  retarget(rawPts, dt, timeSec = 0) {
    if (!rawPts || rawPts.length < 8) return;
    const pts = this.filterBank.smooth(rawPts);

    this._solveSpine(pts, dt, timeSec);

    const hasLeftHand = pts.length >= 29 && this._isHandActive(pts.slice(8, 29), true);
    const hasRightHand = pts.length >= 50 && this._isHandActive(pts.slice(29, 50), false);

    const idleLeftPole = new THREE.Vector3(0.5, 0.0, -0.6).normalize();
    const idleRightPole = new THREE.Vector3(-0.5, 0.0, -0.6).normalize();

    if (hasLeftHand && pts[8]) {
      const targetW = this._landmarkToWorld(pts[8], true, 0.26);
      this.currentLeftWrist.lerp(targetW, 1.0 - Math.exp(-dt * 20.0));
      this._solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.currentLeftWrist, this.upperArmLength, this.forearmLength, this.leftPole, dt);
      this._solveHandOrientation("Left", pts.slice(8, 29), dt);
      this._solveFingers("Left", pts.slice(8, 29), dt);
    } else {
      this.currentLeftWrist.lerp(this.leftWristRest, 1.0 - Math.exp(-dt * 5.0));
      this._solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.currentLeftWrist, this.upperArmLength, this.forearmLength, idleLeftPole, dt);
      this._relaxHand("Left", dt);
    }

    if (hasRightHand && pts[29]) {
      const targetW = this._landmarkToWorld(pts[29], false, 0.26);
      this.currentRightWrist.lerp(targetW, 1.0 - Math.exp(-dt * 20.0));
      this._solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.currentRightWrist, this.upperArmLength, this.forearmLength, this.rightPole, dt);
      this._solveHandOrientation("Right", pts.slice(29, 50), dt);
      this._solveFingers("Right", pts.slice(29, 50), dt);
    } else {
      this.currentRightWrist.lerp(this.rightWristRest, 1.0 - Math.exp(-dt * 5.0));
      this._solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.currentRightWrist, this.upperArmLength, this.forearmLength, idleRightPole, dt);
      this._relaxHand("Right", dt);
    }

    if (pts.length >= 66) {
      this._solveFace(pts.slice(50, 66), dt, timeSec);
    }
  }

  updateIdle(timeSec, dt) {
    const breathRate = 1.85;
    const breath = Math.sin(timeSec * breathRate);
    const spine = this.bones["Spine"];
    if (spine && this.restLocalPos["Spine"]) {
      spine.position.y = this.restLocalPos["Spine"].y + breath * 0.003;
      const breathPitch = breath * 0.010;
      const idleSway = Math.sin(timeSec * 0.70) * 0.006;
      const targetSpineQ = this.restLocalQ["Spine"].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(breathPitch, 0, idleSway, "YXZ"))
      );
      spine.quaternion.slerp(targetSpineQ, 1.0 - Math.exp(-dt * 6.0));
    }

    const breathOffset = new THREE.Vector3(0, breath * 0.003, 0);
    const targetL = this.leftWristRest.clone().add(breathOffset);
    const targetR = this.rightWristRest.clone().add(breathOffset);

    this.currentLeftWrist.lerp(targetL, 1.0 - Math.exp(-dt * 5.0));
    this.currentRightWrist.lerp(targetR, 1.0 - Math.exp(-dt * 5.0));

    const idleLeftPole = new THREE.Vector3(0.5, 0.0, -0.6).normalize();
    const idleRightPole = new THREE.Vector3(-0.5, 0.0, -0.6).normalize();

    this._solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.currentLeftWrist, this.upperArmLength, this.forearmLength, idleLeftPole, dt);
    this._solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.currentRightWrist, this.upperArmLength, this.forearmLength, idleRightPole, dt);

    this._relaxHand("Left", dt);
    this._relaxHand("Right", dt);

    const head = this.bones["Head"];
    if (head && this.restLocalQ["Head"]) {
      const headYaw = Math.sin(timeSec * 0.50) * 0.020;
      const headPitch = Math.cos(timeSec * 0.75) * 0.012 - breath * 0.006;
      const headRoll = Math.sin(timeSec * 0.35) * 0.008;
      const targetHeadQ = this.restLocalQ["Head"].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(headPitch, headYaw, headRoll, "YXZ"))
      );
      head.quaternion.slerp(targetHeadQ, 1.0 - Math.exp(-dt * 5.0));
    }

    if (this.headMesh && this.headMesh.morphTargetDictionary && this.headMesh.morphTargetInfluences) {
      const smileIdx = this.headMesh.morphTargetDictionary["mouthSmile"];
      if (smileIdx !== undefined) this.headMesh.morphTargetInfluences[smileIdx] = 0.10;
      const openIdx = this.headMesh.morphTargetDictionary["mouthOpen"];
      if (openIdx !== undefined) this.headMesh.morphTargetInfluences[openIdx] = 0.0;
    }
  }

  _applyReadyStance(timeSec) {
    const idleLeftPole = new THREE.Vector3(0.5, 0.0, -0.6).normalize();
    const idleRightPole = new THREE.Vector3(-0.5, 0.0, -0.6).normalize();
    this._solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.leftWristRest, this.upperArmLength, this.forearmLength, idleLeftPole, 1.0);
    this._solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.rightWristRest, this.upperArmLength, this.forearmLength, idleRightPole, 1.0);
    this._relaxHand("Left", 1.0);
    this._relaxHand("Right", 1.0);
  }

  _landmarkToWorld(p, isLeftHand, forwardZ = 0.20) {
    if (!p || isNaN(p[0]) || isNaN(p[1])) {
      return isLeftHand ? this.leftWristRest.clone() : this.rightWristRest.clone();
    }

    const clampedX = THREE.MathUtils.clamp(p[0], -0.85, 0.85);
    const clampedY = THREE.MathUtils.clamp(p[1], -0.85, 0.85);
    const landmarkZ = (p[2] || 0) * this.shoulderWidth;

    return new THREE.Vector3(
      this.shoulderCenter.x + clampedX * this.shoulderWidth,
      this.shoulderCenter.y + clampedY * this.shoulderWidth,
      this.shoulderCenter.z + forwardZ + landmarkZ
    );
  }

  _isHandActive(hPts, isLeftHand = false) {
    if (!hPts || hPts.length === 0 || !hPts[0]) return false;
    const w = hPts[0];
    if (isNaN(w[0]) || isNaN(w[1])) return false;
    const mag = Math.hypot(w[0], w[1], w[2] || 0);
    return mag > 0.06;
  }

  _solveTwoBoneIK(shoulderName, foreArmName, shoulderPos, targetWrist, L1, L2, pole, dt) {
    const dVec = new THREE.Vector3().subVectors(targetWrist, shoulderPos);
    let d = dVec.length();
    const maxReach = (L1 + L2) * 0.985;
    const minReach = Math.max(0.12, Math.abs(L1 - L2) * 1.05);
    d = Math.max(minReach, Math.min(maxReach, d));
    const dir = dVec.clone().normalize();

    const cosAlpha = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));

    const planeNormal = new THREE.Vector3().crossVectors(dir, pole).normalize();
    const bendDir = new THREE.Vector3().crossVectors(planeNormal, dir).normalize();

    const elbowPos = shoulderPos.clone()
      .addScaledVector(dir, L1 * Math.cos(alpha))
      .addScaledVector(bendDir, L1 * Math.sin(alpha));

    this._solveBoneDirection(shoulderName, shoulderPos, elbowPos, dt);
    this._solveBoneDirection(foreArmName, elbowPos, targetWrist, dt);
  }

  _solveBoneDirection(boneName, pProx, pDist, dt) {
    const bone = this.bones[boneName];
    if (!bone || !bone.parent) return;

    const vTarget = new THREE.Vector3().subVectors(pDist, pProx);
    if (vTarget.lengthSq() < 1e-6) return;
    vTarget.normalize();

    const uBind = this.uBindWorld[boneName];
    if (!uBind) return;

    const qRotWorld = new THREE.Quaternion().setFromUnitVectors(uBind, vTarget);
    const qTargetWorld = qRotWorld.multiply(this.bindWorldQ[boneName]);

    const parentWorldQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const qTargetLocal = parentWorldQ.invert().multiply(qTargetWorld);

    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 22.0);
    bone.quaternion.slerp(qTargetLocal, alpha);
    this.lastLocalQ[boneName].copy(bone.quaternion);
    bone.updateMatrixWorld(true);
  }

  _solveHandOrientation(prefix, hPts, dt) {
    const handBone = this.bones[`${prefix}Hand`];
    if (!handBone || !handBone.parent) return;

    const inwardYaw = prefix === "Left" ? -0.14 : 0.14;
    const forwardPitch = 0.22;
    const uprightWorldQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(forwardPitch, inwardYaw, 0, "YXZ")
    );

    const parentWorldQ = handBone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetLocalQ = parentWorldQ.invert().multiply(uprightWorldQ);

    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 16.0);
    handBone.quaternion.slerp(targetLocalQ, alpha);
  }

  _solveFingers(prefix, hPts, dt) {
    if (hPts.length < 21) return;

    const digitNames = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
    const digitIndices = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ];

    const maxPhalanxFlex = [
      [0.30, 0.60, 0.85],
      [1.10, 1.40, 0.70],
      [1.12, 1.42, 0.72],
      [1.10, 1.40, 0.70],
      [1.00, 1.30, 0.65],
    ];

    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 20.0);

    for (let d = 0; d < 5; d++) {
      const dName = digitNames[d];
      const indices = digitIndices[d];

      const p0 = hPts[indices[0]];
      const p1 = hPts[indices[1]];
      const p2 = hPts[indices[2]];
      const p3 = hPts[indices[3]];
      if (!p0 || !p1 || !p2 || !p3) continue;

      const seg1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const seg2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const seg3 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
      const maxReach = seg1 + seg2 + seg3;
      const directDist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);

      if (maxReach < 1e-4) continue;

      const curlRatio = THREE.MathUtils.clamp(directDist / maxReach, 0.0, 1.0);
      const norm = THREE.MathUtils.clamp((0.57 - curlRatio) / 0.22, 0.0, 1.0);
      const smoothedCurl = norm * norm * (3.0 - 2.0 * norm);

      for (let ph = 0; ph < 3; ph++) {
        const boneName = `${prefix}Hand${dName}${ph + 1}`;
        const bone = this.bones[boneName];
        if (!bone || !this.restLocalQ[boneName]) continue;

        const flex = maxPhalanxFlex[d][ph] * smoothedCurl;

        const targetQ = this.restLocalQ[boneName].clone().multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(flex, 0, 0, "YXZ"))
        );

        bone.quaternion.slerp(targetQ, alpha);
        this.lastLocalQ[boneName].copy(bone.quaternion);
      }
    }
  }

  _relaxHand(prefix, dt) {
    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 6.0);

    const handBone = this.bones[`${prefix}Hand`];
    if (handBone && this.restLocalQ[`${prefix}Hand`]) {
      const roll = prefix === "Left" ? 0.20 : -0.20;
      const pitch = 0.10;
      const targetQ = this.restLocalQ[`${prefix}Hand`].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll, "YXZ"))
      );
      handBone.quaternion.slerp(targetQ, alpha);
    }

    const digitNames = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
    const flexions = [
      [0.15, 0.20, 0.15],
      [0.22, 0.28, 0.18],
      [0.25, 0.32, 0.20],
      [0.22, 0.28, 0.18],
      [0.18, 0.22, 0.15],
    ];

    for (let d = 0; d < 5; d++) {
      const dName = digitNames[d];
      for (let ph = 1; ph <= 3; ph++) {
        const boneName = `${prefix}Hand${dName}${ph}`;
        const bone = this.bones[boneName];
        if (!bone || !this.restLocalQ[boneName]) continue;

        const flex = flexions[d][ph - 1];
        const targetQ = this.restLocalQ[boneName].clone().multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(flex, 0, 0, "YXZ"))
        );
        bone.quaternion.slerp(targetQ, alpha);
      }
    }
  }

  _solveSpine(pts, dt, timeSec) {
    const spine = this.bones["Spine"];
    if (!spine || !this.restLocalQ["Spine"] || pts.length < 2) return;

    const breath = Math.sin(timeSec * 1.85) * 0.003;
    if (this.restLocalPos["Spine"]) {
      spine.position.y = this.restLocalPos["Spine"].y + breath;
    }

    let handMidX = 0;
    if (pts.length >= 50) {
      const lw = pts[8], rw = pts[29];
      if (lw && rw) handMidX = (lw[0] + rw[0]) * 0.5;
    }

    const rollZ = THREE.MathUtils.clamp(-handMidX * 0.15, -0.08, 0.08);
    const targetQ = this.restLocalQ["Spine"].clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(breath * 0.008, 0, rollZ, "YXZ"))
    );
    spine.quaternion.slerp(targetQ, 1.0 - Math.exp(-dt * 8.0));
  }

  _solveFace(fPts, dt, timeSec) {
    if (!fPts || fPts.length < 16) return;

    const head = this.bones["Head"];
    if (head && this.restLocalQ["Head"]) {
      const pLeft = fPts[4];
      const pRight = fPts[8];
      const pChin = fPts[0];

      let yaw = 0;
      let pitch = 0;
      let roll = 0;

      if (pLeft && pRight) {
        const midFaceX = (pLeft[0] + pRight[0]) * 0.5;
        yaw = THREE.MathUtils.clamp(midFaceX * 1.2, -0.15, 0.15);
      }

      if (pChin) {
        pitch = THREE.MathUtils.clamp((pChin[1] - 0.48) * 0.8, -0.10, 0.10);
      }

      roll = THREE.MathUtils.clamp(Math.sin(timeSec * 0.35) * 0.008, -0.05, 0.05);

      const targetHeadQ = this.restLocalQ["Head"].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"))
      );
      head.quaternion.slerp(targetHeadQ, 1.0 - Math.exp(-dt * 10.0));
    }

    const upperLip = fPts[12];
    const lowerLip = fPts[10];
    if (upperLip && lowerLip) {
      const dist = Math.hypot(upperLip[0] - lowerLip[0], upperLip[1] - lowerLip[1]);
      const open = THREE.MathUtils.clamp((dist - 0.02) * 5.0, 0, 0.7);

      if (this.headMesh && this.headMesh.morphTargetDictionary && this.headMesh.morphTargetInfluences) {
        const idxOpen = this.headMesh.morphTargetDictionary["mouthOpen"];
        if (idxOpen !== undefined) this.headMesh.morphTargetInfluences[idxOpen] = open;
      }
      if (this.teethMesh && this.teethMesh.morphTargetDictionary && this.teethMesh.morphTargetInfluences) {
        const idxOpen = this.teethMesh.morphTargetDictionary["mouthOpen"];
        if (idxOpen !== undefined) this.teethMesh.morphTargetInfluences[idxOpen] = open;
      }
    }
  }
}
window.AnatomicalRetargeter = AnatomicalRetargeter;


// ─── 3. SKINNED AVATAR RENDERER (Three.js WebGL) ───────────────────────────
class SkinnedAvatarRenderer {
  constructor(containerEl, modelUrl = "/static/models/michelle.glb") {
    this.container = containerEl;
    this.modelUrl = modelUrl;
    this.showWireframe = false;
    this._debugObjs = [];
    this._tLast = performance.now();
    this._tStart = performance.now();
    this._lastFrameTime = 0;
    this.retargeter = null;

    this._initScene();
    this._loadModel(this.modelUrl);
  }

  _initScene() {
    const w = this.container.clientWidth || 640;
    const h = this.container.clientHeight || 540;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f8fa);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 50);
    this.camera.position.set(0, 1.35, 1.25);
    this.camera.lookAt(0, 1.30, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.fillLight = new THREE.HemisphereLight(0xffffff, 0xd2dbe6, 0.75);
    this.scene.add(this.fillLight);

    this.keyLight = new THREE.DirectionalLight(0xfffaf2, 1.25);
    this.keyLight.position.set(1.5, 2.8, 2.2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0xa8c6e8, 0.75);
    this.rimLight.position.set(-1.5, 2.2, -2.0);
    this.scene.add(this.rimLight);

    const groundGeo = new THREE.PlaneGeometry(6, 6);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xebeef3,
      roughness: 0.95,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI * 0.5;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this._dbgGeo = new THREE.SphereGeometry(0.016, 8, 6);
    this._dbgMat = new THREE.MeshBasicMaterial({ color: 0x1d4ed8 });

    window.addEventListener("resize", () => this._onResize());
    this._animate();
  }

  _loadModel(url) {
    const loader = new THREE.GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.scene.add(model);
        this.retargeter = new AnatomicalRetargeter(model);
      },
      undefined,
      (err) => {
        console.error("Failed to load model:", url, err);
        // Fallback to avatar.glb
        if (url !== "/static/models/avatar.glb") {
          this._loadModel("/static/models/avatar.glb");
        }
      }
    );
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setWireframeDebug(on) {
    this.showWireframe = !!on;
    this._debugObjs.forEach((o) => (o.visible = this.showWireframe));
  }

  _updateDebug(pts) {
    if (!pts) return;
    while (this._debugObjs.length < pts.length) {
      const s = new THREE.Mesh(this._dbgGeo, this._dbgMat);
      s.visible = this.showWireframe;
      this.scene.add(s);
      this._debugObjs.push(s);
    }
    const center = this.retargeter ? this.retargeter.shoulderCenter : new THREE.Vector3(0, 1.48, -0.02);
    const width = this.retargeter ? this.retargeter.shoulderWidth : 0.332;
    const forwardZ = 0.20;

    pts.forEach((p, i) => {
      const obj = this._debugObjs[i];
      if (!p || isNaN(p[0]) || isNaN(p[1])) {
        obj.position.set(999, 999, 999);
        return;
      }
      obj.position.set(
        center.x + p[0] * width,
        center.y + p[1] * width,
        center.z + forwardZ + (p[2] || 0) * width
      );
    });
  }

  applyFrame(frame) {
    if (!frame) return;
    const now = performance.now();
    const dt = Math.max((now - this._tLast) * 0.001, 0.006);
    this._tLast = now;
    this._lastFrameTime = now;
    const timeSec = (now - this._tStart) * 0.001;

    if (Array.isArray(frame)) {
      if (this.retargeter) {
        this.retargeter.retarget(frame, dt, timeSec);
      }
      if (this.showWireframe) {
        this._updateDebug(frame);
      }
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const now = performance.now();
    const dt = Math.max((now - this._tLast) * 0.001, 0.006);
    this._tLast = now;
    const timeSec = (now - this._tStart) * 0.001;

    if (this.retargeter && now - this._lastFrameTime > 800) {
      this.retargeter.updateIdle(timeSec, dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// ── Window Exports ──────────────────────────────────────────────────────────
window.SkinnedAvatarRenderer = SkinnedAvatarRenderer;
window.AnatomicalRetargeter  = AnatomicalRetargeter;
window.AvatarRig             = class {};
window.OneEuroFilter         = _OEF;