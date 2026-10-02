// P1: the map of the lot's position (Leaflet + OpenStreetMap tiles, with the attribution the OSM tile policy asks for;
// tiles load only while this map is open). Click to place the lot; in "street" mode, two clicks along the street front
// (left corner, then right corner, seen from the street) give the bearing of the lot's x axis.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ccwLot, lotBox } from '../model/lot';
import type { Lot } from '../model/schema';
import { useT } from '../i18n/useT';

const rad = Math.PI / 180;
/** Initial compass bearing from a to b (degrees, 0 = north). */
export function bearing(a: [number, number], b: [number, number]): number {
  const [la1, lo1] = [a[0] * rad, a[1] * rad], [la2, lo2] = [b[0] * rad, b[1] * rad];
  const y = Math.sin(lo2 - lo1) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

/** The lot outline on the map, centred on its position and turned by its x bearing. */
function outline(lot: Lot): [number, number][] {
  const l = ccwLot(lot), bx = lotBox(l.polygon);
  const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2, b = l.geo.xBearing * rad, by = b - Math.PI / 2;
  return l.polygon.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const east = dx * Math.sin(b) + dy * Math.sin(by), north = dx * Math.cos(b) + dy * Math.cos(by);
    return [l.geo.lat + north / 111320, l.geo.lon + east / (111320 * Math.cos(l.geo.lat * rad))];
  });
}

export default function LotMap({ lot, mode, onPick, onStreet }: {
  lot: Lot;
  mode: 'pick' | 'street';
  onPick: (lat: number, lon: number) => void;
  onStreet: (xBearing: number) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const clicks = useRef<[number, number][]>([]);
  const cb = useRef({ mode, onPick, onStreet });
  cb.current = { mode, onPick, onStreet };

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([lot.geo.lat, lot.geo.lon], 18);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      if (cb.current.mode === 'street') {
        clicks.current = [...clicks.current, [lat, lng]];
        if (clicks.current.length === 2) { cb.current.onStreet(bearing(clicks.current[0]!, clicks.current[1]!)); clicks.current = []; }
        return;
      }
      cb.current.onPick(Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6);
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // the map is made once; the lot is drawn by the effect below
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    L.polygon(outline(lot), { color: '#2f6f4f', weight: 2, fillOpacity: 0.15 }).addTo(g);
    L.circleMarker([lot.geo.lat, lot.geo.lon], { radius: 5, color: '#c0392b' }).addTo(g);
    if (!m.getBounds().contains([lot.geo.lat, lot.geo.lon])) m.panTo([lot.geo.lat, lot.geo.lon]);
  }, [lot]);

  useEffect(() => { clicks.current = []; }, [mode]);

  return (
    <div className="lotmap-wrap">
      <div ref={box} className="lotmap" data-testid="lot-map" aria-label={t('Map of the lot')} />
      <p className="hint maphint">{mode === 'street' ? t('Click the front-left corner of the lot, then the front-right corner (seen from the street).') : t('Click on the map where the lot is.')}</p>
    </div>
  );
}
