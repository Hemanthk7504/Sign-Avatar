/**
 * Lightweight procedural humanoid rig rendered with Three.js primitives.
 *
 * This stands in for a rigged/skinned GLTF avatar (the paper's system would
 * drive a full mesh with blendshapes + skeletal skinning). The joint
 * hierarchy below mirrors exactly the joint names produced by the backend
 * (see app/services/gloss_dictionary.py JOINTS), so swapping this file for a
 * real skinned-mesh loader later only requires mapping the same joint-name
 * -> bone-rotation dictionary onto real bones instead of these pivots.
 */

class SignAvatar {
  constructor(containerEl) {
    this.container = containerEl;
    this.pivots = {};
    this._initScene();
    this._buildRig();
    this._animate();
  }

  _initScene() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    this.camera.position.set(0, 1.35, 4.2);
    this.camera.lookAt(0, 1.1, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.container.appendChild(this.renderer.domElement);

    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0x8890c0, 0.65));

    window.addEventListener("resize", () => {
      const w2 = this.container.clientWidth, h2 = this.container.clientHeight;
      this.camera.aspect = w2 / h2;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w2, h2);
    });
  }

  _limb(length, radius, color) {
    const geo = new THREE.CapsuleGeometry(radius, length, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -length / 2 - radius; // pivot at top, mesh hangs below
    return mesh;
  }

  _buildRig() {
    const skin = 0x9fb4ff;
    const cloth = 0x4a5680;

    // root -> spine -> chest -> {neck->head, shoulder_l chain, shoulder_r chain}
    const root = new THREE.Group();
    root.position.set(0, 0, 0);
    this.scene.add(root);
    this.pivots.spine = root; // treat root as spine pivot for simplicity

    const chest = new THREE.Group();
    chest.position.set(0, 0.55, 0);
    const chestMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 0.5, 4, 8),
      new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.6 })
    );
    chestMesh.position.y = 0.25;
    chest.add(chestMesh);
    root.add(chest);
    this.pivots.chest = chest;

    const neck = new THREE.Group();
    neck.position.set(0, 0.55, 0);
    chest.add(neck);
    this.pivots.neck = neck;

    const head = new THREE.Group();
    head.position.set(0, 0.14, 0);
    const headMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 20, 20),
      new THREE.MeshStandardMaterial({ color: skin, roughness: 0.5 })
    );
    headMesh.position.y = 0.16;
    head.add(headMesh);
    neck.add(head);
    this.pivots.head = head;

    // Face (non-manual features)
    this.face = {};
    const browMat = new THREE.MeshStandardMaterial({ color: 0x2a2f4a });
    const browGeo = new THREE.BoxGeometry(0.07, 0.015, 0.02);
    this.face.browL = new THREE.Mesh(browGeo, browMat);
    this.face.browL.position.set(0.05, 0.22, 0.145);
    this.face.browR = new THREE.Mesh(browGeo, browMat);
    this.face.browR.position.set(-0.05, 0.22, 0.145);
    head.add(this.face.browL, this.face.browR);
    this.face.browBaseY = 0.22;

    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x7a3b3b });
    this.face.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.02), mouthMat);
    this.face.mouth.position.set(0, 0.10, 0.155);
    head.add(this.face.mouth);

    // Arms: shoulder -> elbow -> wrist -> hand
    ["l", "r"].forEach((side) => {
      const sign = side === "l" ? 1 : -1;
      const shoulder = new THREE.Group();
      shoulder.position.set(sign * 0.24, 0.42, 0);
      chest.add(shoulder);
      shoulder.add(this._limb(0.26, 0.055, skin));
      this.pivots[`shoulder_${side}`] = shoulder;

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.26, 0);
      shoulder.add(elbow);
      elbow.add(this._limb(0.24, 0.048, skin));
      this.pivots[`elbow_${side}`] = elbow;

      const wrist = new THREE.Group();
      wrist.position.set(0, -0.24, 0);
      elbow.add(wrist);
      this.pivots[`wrist_${side}`] = wrist;

      const hand = new THREE.Group();
      wrist.add(hand);
      const handMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 12),
        new THREE.MeshStandardMaterial({ color: skin, roughness: 0.5 })
      );
      handMesh.position.y = -0.06;
      hand.add(handMesh);
      this.pivots[`hand_${side}`] = hand;
    });

    // Simple hips/legs for visual grounding (static, not driven by pipeline)
    const hips = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.15, 4, 8),
      new THREE.MeshStandardMaterial({ color: cloth })
    );
    hips.position.y = 0.15;
    root.add(hips);
    ["l", "r"].forEach((side) => {
      const sign = side === "l" ? 1 : -1;
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.06, 0.55, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2c3050 })
      );
      leg.position.set(sign * 0.1, -0.35, 0);
      root.add(leg);
    });
  }

  /** Apply one backend Pose frame: { joints: {name:[x,y,z]}, face: {...} } */
  applyFrame(frame) {
    if (!frame) return;
    const joints = frame.joints || {};
    for (const [name, rot] of Object.entries(joints)) {
      const pivot = this.pivots[name];
      if (pivot && Array.isArray(rot)) {
        pivot.rotation.set(rot[0], rot[1], rot[2]);
      }
    }
    const face = frame.face || {};
    const browsUp = face.eyebrows_up || 0;
    const browsDown = face.eyebrows_down || 0;
    const browOffset = browsUp * 0.03 - browsDown * 0.02;
    this.face.browL.position.y = this.face.browBaseY + browOffset;
    this.face.browR.position.y = this.face.browBaseY + browOffset;
    this.face.browL.rotation.z = -browsDown * 0.4;
    this.face.browR.rotation.z = browsDown * 0.4;

    const smile = face.mouth_smile ?? 0;
    const open = face.mouth_open || 0;
    this.face.mouth.scale.set(1 + smile * 0.4, 1 + open * 3, 1);
    this.face.mouth.rotation.z = 0;
    this.face.mouth.position.y = 0.10 - Math.max(0, -smile) * 0.01 + Math.max(0, smile) * 0.01;
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
  }
}

window.SignAvatar = SignAvatar;
