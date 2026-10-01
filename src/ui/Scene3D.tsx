// The 3D view. It draws the parts built from the model (build3d.ts); it keeps no geometry of its own.
import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SERVICE_MATS, buildScene, pocheCaps, type BoxPart, type Mat, type Part, type LinePart, type PipePart, type PolyPart, type V3 } from '../scene/build3d';
import { sunPosition } from '../scene/sun';
import { EYE, startAt, walkStep, walkWorld, type WalkState, type WalkWorld } from '../scene/walk';
import { useApp, useProject, type CameraPreset } from '../store';
import { Controls3D, walkKeys } from './Controls3D';

/** House coordinates (x north, y rear, z up) → three.js (y up). */
export const T = ([x, y, z]: V3): [number, number, number] => [x, z, -y];

const COLORS: Record<Mat, string> = {
  wallExt: '#EDE9E1', wallInt: '#F5F3EF', wallWet: '#DCE7E7', retaining: '#A9A59C', plinth: '#B5B0A5', parapet: '#E6E2DA',
  slab: '#C9C6BE', roof: '#B7BBBD', steel: '#3E4A55', concrete: '#A8A49B', footing: '#8E8A82',
  glass: '#8FB8D2', frame: '#2E3A40', door: '#B08455', garageDoor: '#8D9499', tread: '#9A7650', guardGlass: '#BFD9E6', rail: '#2E3A40', deck: '#A27B55',
  grass: '#8DAA69', paving: '#CFC9BC', soil: '#9C8B73', ramp: '#C8BFAE', asphalt: '#55595B', sidewalk: '#C9C6BF', boundary: '#D6D0C4', setback: '#E07A2E',
  marking: '#F6F6F2', solarGhost: '#23395B', device: '#2E3A40', planter: '#6F8F4E',
  pCold: '#2F7FB5', pHot: '#C8412E', pSewage: '#8A5A2B', pVent: '#8C9399', pRain: '#25A3A3', fixture: '#F4F4F2', equipment: '#6E7B85', tank: '#4F7FA6',
};
const TRANSPARENT: Partial<Record<Mat, number>> = { glass: 0.35, guardGlass: 0.25, solarGhost: 0.45 };

const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(mat: Mat, selected: boolean, ghost = false): THREE.MeshStandardMaterial {
  const key = mat + (selected ? ':sel' : '') + (ghost ? ':ghost' : '');
  let m = materials.get(key);
  if (!m) {
    const op = ghost ? 0.07 : TRANSPARENT[mat];
    m = new THREE.MeshStandardMaterial({
      color: COLORS[mat], roughness: mat === 'glass' || mat === 'guardGlass' ? 0.1 : 0.85, metalness: mat === 'steel' || mat === 'rail' ? 0.4 : 0,
      transparent: op !== undefined, opacity: op ?? 1, depthWrite: op === undefined, side: THREE.DoubleSide,
      ...(selected ? { emissive: new THREE.Color('#2B6389'), emissiveIntensity: 0.55 } : {}),
    });
    materials.set(key, m);
  }
  return m;
}
const allMaterials = () => [...materials.values()];

const unitBox = new THREE.BoxGeometry(1, 1, 1);

function Box({ b, selected, ghost }: { b: BoxPart; selected: boolean; ghost: boolean }) {
  const glassy = b.mat === 'glass' || b.mat === 'guardGlass' || ghost;
  return (
    <mesh
      geometry={unitBox} material={material(b.mat, selected, ghost)}
      position={T(b.c)} scale={[b.s[0], b.s[2], b.s[1]]} rotation={[b.rx ?? 0, b.rz ?? 0, 0]}
      castShadow={!glassy} receiveShadow
    />
  );
}

const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
const Y = new THREE.Vector3(0, 1, 0);

function Pipe({ part, selected }: { part: PipePart; selected: boolean }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...T(part.a)), b = new THREE.Vector3(...T(part.b));
    const d = b.clone().sub(a);
    return { pos: a.clone().add(b).multiplyScalar(0.5), quat: new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()), len: d.length() };
  }, [part]);
  return <mesh geometry={unitCylinder} material={material(part.mat, selected)} position={pos} quaternion={quat} scale={[part.r, len, part.r]} />;
}

function Poly({ part, ghost }: { part: PolyPart; ghost: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const v = part.pts.map(T);
    const idx: number[] = [];
    for (let i = 1; i + 1 < v.length; i++) idx.push(0, i, i + 1);
    g.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [part]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material(part.mat, false, ghost)} receiveShadow raycast={() => null} />;
}

const Group = memo(function Group({ id, parts, selected, pickable, xray }: { id: string; parts: Part[]; selected: boolean; pickable: boolean; sig: string; xray: boolean }) {
  const pick = useApp((s) => s.pick);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    pick(id);
  };
  return (
    <group onClick={pickable ? onClick : undefined} raycast={pickable ? undefined : () => null} name={id}>
      {parts.map((p, i) => {
        const ghost = xray && !SERVICE_MATS.has(p.mat);
        if (p.kind === 'box') return pickable ? <Box key={i} b={p} selected={selected} ghost={ghost} /> : <mesh key={i} geometry={unitBox} material={material(p.mat, false, ghost)} position={T(p.c)} scale={[p.s[0], p.s[2], p.s[1]]} castShadow={!ghost} receiveShadow raycast={() => null} />;
        if (p.kind === 'poly') return <Poly key={i} part={p} ghost={ghost} />;
        if (p.kind === 'pipe') return <Pipe key={i} part={p} selected={selected} />;
        return <Line key={i} points={(p as LinePart).pts.map(T)} color={COLORS[p.mat]} lineWidth={2} dashed dashSize={0.6} gapSize={0.3} raycast={() => null} />;
      })}
    </group>
  );
}, (a, b) => a.sig === b.sig && a.selected === b.selected && a.id === b.id && a.xray === b.xray);

/* ---------- camera presets ---------- */

const PRESETS: Record<CameraPreset, { pos: V3; target: V3 }> = {
  street: { pos: [4.3, -15.5, 3.4], target: [4.3, 6, 2.0] },
  garden: { pos: [4.6, 26.5, 2.4], target: [4.3, 13, -0.2] },
  ramp: { pos: [11.4, -3.2, 1.8], target: [9.6, 12, -1.4] },
  top: { pos: [4.3, 7.0, 42], target: [4.3, 7.5, 0] },
};

function CameraRig() {
  const req = useApp((s) => s.camera);
  const walking = useApp((s) => s.walk);
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update(): void } | null };
  useEffect(() => {
    const p = req.pos && req.target ? { pos: req.pos, target: req.target } : PRESETS[req.preset];
    // Presets are framed for a wide view; step back when the view is narrow (split view, tablet).
    const k = Math.max(1, 1.5 / Math.max(camera.aspect, 0.3));
    const pos: V3 = [0, 1, 2].map((i) => p.target[i]! + (p.pos[i]! - p.target[i]!) * k) as V3;
    camera.position.set(...T(pos));
    camera.up.set(0, 1, 0);
    if (controls) { controls.target.set(...T(p.target)); controls.update(); } else camera.lookAt(...T(p.target));
  }, [req, camera, controls]); // eslint-disable-line react-hooks/exhaustive-deps -- only when a preset is chosen
  return walking ? null : <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.495} />;
}

/* ---------- walk mode ---------- */

function Walker({ world }: { world: WalkWorld }) {
  const { camera, gl } = useThree();
  const st = useRef<WalkState & { yaw: number; pitch: number }>({ ...startAt(world, 1.4, -6.5), yaw: 0, pitch: 0 });
  const worldRef = useRef(world);
  worldRef.current = world;
  useEffect(() => {
    st.current = { ...startAt(world, 1.4, -6.5), yaw: 0, pitch: -0.05 };
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      st.current.yaw += (e.clientX - drag.x) * 0.005;
      st.current.pitch = Math.max(-1.2, Math.min(1.2, st.current.pitch - (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => { drag = null; };
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, dt) => {
    const s = st.current, k = walkKeys;
    const d = Math.min(dt, 0.1);
    if (k.left) s.yaw -= 1.6 * d;
    if (k.right) s.yaw += 1.6 * d;
    const speed = (k.run ? 3 : 1.4) * d;
    const f = (k.fwd ? 1 : 0) - (k.back ? 1 : 0);
    const r = (k.strafeR ? 1 : 0) - (k.strafeL ? 1 : 0);
    if (f || r) {
      const fx = Math.sin(s.yaw), fy = Math.cos(s.yaw), rx = Math.cos(s.yaw), ry = -Math.sin(s.yaw);
      let dx = (fx * f + rx * r) * speed, dy = (fy * f + ry * r) * speed;
      // small sub-steps so stairs and walls behave
      const n = Math.ceil(Math.hypot(dx, dy) / 0.04);
      dx /= n; dy /= n;
      for (let i = 0; i < n; i++) Object.assign(s, walkStep(worldRef.current, s, dx, dy));
    }
    const eye: V3 = [s.x, s.y, s.foot + EYE];
    camera.position.set(...T(eye));
    const look: V3 = [s.x + Math.sin(s.yaw) * Math.cos(s.pitch), s.y + Math.cos(s.yaw) * Math.cos(s.pitch), s.foot + EYE + Math.sin(s.pitch)];
    camera.lookAt(...T(look));
  });
  return null;
}

/* ---------- sun, section, test hook ---------- */

function Sun() {
  const sun = useApp((s) => s.sun);
  const light = useRef<THREE.DirectionalLight>(null);
  const pos = sunPosition(2026, sun.month, sun.day, sun.hour);
  const up = pos.altitude > 0;
  const center: V3 = [4.3, 7.5, 0];
  const at = T([center[0] + pos.dir[0] * 60, center[1] + pos.dir[1] * 60, center[2] + pos.dir[2] * 60]);
  const { scene } = useThree();
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.set(...T(center));
    scene.add(l.target);
    return () => { scene.remove(l.target); };
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <hemisphereLight args={['#EEF3F6', '#8A8474', up ? 0.9 : 0.45]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        ref={light} position={at} intensity={up ? 2.4 * Math.min(1, 0.25 + Math.sin(pos.altitude * Math.PI / 180) * 1.5) : 0}
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={28} shadow-camera-bottom={-28} shadow-camera-near={1} shadow-camera-far={140}
      />
    </>
  );
}

function SectionClip() {
  const section = useApp((s) => s.section);
  const p = useProject();
  const { gl } = useThree();
  const planes = useMemo(() => {
    const out: THREE.Plane[] = [];
    if (section.h !== 'off') {
      const e = p.levels.find((l) => l.id === section.h)?.elevation ?? 0;
      out.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), e + 1.2));
    }
    if (section.v === 'across') out.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), -section.pos));
    if (section.v === 'along') out.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), section.pos));
    return out;
  }, [section, p.levels]);
  useEffect(() => {
    gl.localClippingEnabled = true;
    for (const m of allMaterials()) {
      if ((m.clippingPlanes?.length ?? 0) !== planes.length) m.needsUpdate = true;
      m.clippingPlanes = planes;
    }
  });
  return (
    <>
      <Poche />
      {section.v !== 'off' && <SectionHandle />}
    </>
  );
}

/* Filled cut faces ("poché"): where a cut plane passes through a solid box, a dark cap closes it. */
const pocheMat = new THREE.MeshBasicMaterial({ color: '#2B3136', side: THREE.DoubleSide });
function Poche() {
  const section = useApp((s) => s.section);
  const p = useProject();
  const doorsOpen = useApp((s) => s.doorsOpen);
  const caps = useMemo(() => {
    const cuts: { axis: 'x' | 'y' | 'z'; at: number; keep: 1 | -1 }[] = [];
    if (section.h !== 'off') cuts.push({ axis: 'z', at: (p.levels.find((l) => l.id === section.h)?.elevation ?? 0) + 1.2, keep: -1 });
    if (section.v === 'across') cuts.push({ axis: 'y', at: section.pos, keep: 1 });
    if (section.v === 'along') cuts.push({ axis: 'x', at: section.pos, keep: -1 });
    return cuts.length ? pocheCaps(buildScene(p, { doorsOpen }).parts, cuts) : [];
  }, [section, p, doorsOpen]);
  return (
    <group raycast={() => null}>
      {caps.map((b, i) => <mesh key={i} geometry={unitBox} material={pocheMat} position={T(b.c)} scale={[b.s[0], b.s[2], b.s[1]]} raycast={() => null} />)}
    </group>
  );
}

const HANDLE_Z = 8;
const handleMat = new THREE.MeshBasicMaterial({ color: '#B4432F' });

/** The red frame of the vertical section, with a bar on top you can drag. */
function SectionHandle() {
  const section = useApp((s) => s.section);
  const { controls } = useThree() as unknown as { controls: { enabled: boolean } | null };
  const drag = useRef(false);
  const across = section.v === 'across';
  const quad: [number, number, number][] = across
    ? [T([-3, section.pos, -4]), T([13, section.pos, -4]), T([13, section.pos, HANDLE_Z]), T([-3, section.pos, HANDLE_Z]), T([-3, section.pos, -4])]
    : [T([section.pos, -5, -4]), T([section.pos, 22, -4]), T([section.pos, 22, HANDLE_Z]), T([section.pos, -5, HANDLE_Z]), T([section.pos, -5, -4])];
  const bar: BoxPart = across
    ? { kind: 'box', id: 'handle', mat: 'rail', c: [5, section.pos, HANDLE_Z], s: [16, 0.2, 0.2] }
    : { kind: 'box', id: 'handle', mat: 'rail', c: [section.pos, 8.5, HANDLE_Z], s: [0.2, 27, 0.2] };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    e.stopPropagation();
    const hit = e.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -HANDLE_Z), new THREE.Vector3());
    if (!hit) return;
    const st = useApp.getState();
    const v = across ? Math.min(21, Math.max(-4, -hit.z)) : Math.min(12, Math.max(-2, hit.x));
    st.set3d({ section: { ...st.section, pos: Math.round(v / 0.05) * 0.05 } });
  };
  const end = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    drag.current = false;
    if (controls) controls.enabled = true;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
  };
  return (
    <>
      <Line points={quad} color="#B4432F" lineWidth={2} raycast={() => null} />
      <mesh
        geometry={unitBox} material={handleMat} position={T(bar.c)} scale={[bar.s[0], bar.s[2], bar.s[1]]}
        onPointerDown={(e) => { e.stopPropagation(); drag.current = true; if (controls) controls.enabled = false; (e.target as unknown as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
        onPointerOver={() => { document.body.style.cursor = 'ew-resize'; }} onPointerOut={() => { document.body.style.cursor = ''; }}
      />
    </>
  );
}

function TestHook() {
  const { camera, gl } = useThree();
  const frames = useRef(0);
  useFrame(() => { frames.current++; });
  useEffect(() => {
    (window as unknown as { __casa3d: unknown }).__casa3d = {
      frames: () => frames.current,
      /** Screen position of a house point, for tests. */
      project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(...T([x, y, z])).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
    };
  }, [camera, gl]);
  return null;
}

/* ---------- the view ---------- */

function Content() {
  const p = useProject();
  const doorsOpen = useApp((s) => s.doorsOpen);
  const selection = useApp((s) => s.selection);
  const walking = useApp((s) => s.walk);
  const cutting = useApp((s) => s.section.v !== 'off' || s.section.h !== 'off');
  const xray = useApp((s) => s.xray);
  const scene = useMemo(() => buildScene(p, { doorsOpen }), [p, doorsOpen]);
  const groups = useMemo(() => {
    const m = new Map<string, Part[]>();
    for (const part of scene.parts) m.set(part.id, [...(m.get(part.id) ?? []), part]);
    return [...m.entries()].map(([id, parts]) => ({ id, parts, sig: JSON.stringify(parts) }));
  }, [scene]);
  const world = useMemo(() => walkWorld(buildScene(p, { doorsOpen: true })), [p]);
  const pick = useApp((s) => s.pick);
  return (
    <>
      <color attach="background" args={['#DCE6EB']} />
      <fog attach="fog" args={['#DCE6EB', 60, 160]} />
      <Sun />
      <SectionClip />
      <group onPointerMissed={() => pick(null)}>
        {groups.filter((g) => !(cutting && g.id === 'site:setback')).map((g) => <Group key={g.id} id={g.id} parts={g.parts} sig={g.sig} selected={g.id === selection} pickable={!g.id.startsWith('site:')} xray={xray} />)}
      </group>
      <CameraRig />
      {walking && <Walker world={world} />}
      <TestHook />
    </>
  );
}

export default function Scene3D() {
  return (
    <div className="scene3d" data-testid="scene3d">
      <Canvas
        shadows
        camera={{ fov: 50, near: 0.1, far: 400, position: T(PRESETS.street.pos) }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onPointerMissed={() => useApp.getState().pick(null)}
      >
        <Content />
      </Canvas>
      <Controls3D />
    </div>
  );
}
