// P1: a simple 3D preview of the natural ground of the lot (heights × 3 so a gentle slope shows), street in front.
import { Line, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { ccwLot, lotBox, naturalAt } from '../model/lot';
import type { Lot } from '../model/schema';

const EXAG = 3;

function Ground({ lot }: { lot: Lot }) {
  const l = useMemo(() => ccwLot(lot), [lot]);
  const bx = lotBox(l.polygon);
  const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2;
  // world: x = lot x, z = −lot y (the street towards the camera), y up
  const geo = useMemo(() => {
    // a grid over the bounding box, kept where the lot is
    const n = 24, verts: number[] = [], cols: number[] = [];
    const heights = l.polygon.map(([x, y]) => naturalAt(l, x, y));
    const lo = Math.min(...heights, naturalAt(l, cx, cy)), hi = Math.max(...heights, naturalAt(l, cx, cy));
    const col = (z: number) => { const t = hi - lo > 1e-6 ? (z - lo) / (hi - lo) : 0.5; return [0.55 - 0.25 * t, 0.68 - 0.1 * t, 0.42 - 0.2 * t]; };
    const inside = (x: number, y: number) => l.polygon.every((a, i) => { const b = l.polygon[(i + 1) % l.polygon.length]!; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-6; });
    const P = (i: number, j: number): [number, number] => [bx.x0 + ((bx.x1 - bx.x0) * i) / n, bx.y0 + ((bx.y1 - bx.y0) * j) / n];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      if (!q.every(([x, y]) => inside(x, y))) continue;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y] = q[k]!, z = naturalAt(l, x, y);
        verts.push(x - cx, z * EXAG, -(y - cy));
        cols.push(...col(z));
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    out.computeVertexNormals();
    return out;
  }, [l, bx.x0, bx.x1, bx.y0, bx.y1, cx, cy]);
  const edge = [...l.polygon, l.polygon[0]!].map(([x, y]) => [x - cx, naturalAt(l, x, y) * EXAG + 0.03, -(y - cy)] as [number, number, number]);
  return (
    <group>
      <mesh geometry={geo}><meshStandardMaterial vertexColors side={THREE.DoubleSide} /></mesh>
      <Line points={edge} color="#2f6f4f" lineWidth={2} />
      {/* the street in front */}
      <mesh position={[0, -0.02, (bx.y1 - bx.y0) / 2 + 2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[bx.x1 - bx.x0 + 6, 4]} /><meshStandardMaterial color="#9a9a96" /></mesh>
    </group>
  );
}

export default function LotTerrain3D({ lot }: { lot: Lot }) {
  const bx = lotBox(lot.polygon);
  const size = Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0);
  return (
    <div className="terrain3d" data-testid="terrain-3d">
      <Canvas camera={{ position: [size * 0.45, size * 0.38, size * 0.75], fov: 45 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={['#f4f2ec']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 20, 10]} intensity={1.1} />
        <Ground lot={lot} />
        <OrbitControls enablePan={false} />
      </Canvas>
    </div>
  );
}
