import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { c, f } from '../theme';

/** Roughly the country, matching the bounds the API validates against. */
const LAOS = { minLat: 13.5, maxLat: 22.6, minLng: 100, maxLng: 108 };
const CENTRE: [number, number] = [17.9668, 102.61];

export const inLaos = (lat: number, lng: number) =>
  lat >= LAOS.minLat && lat <= LAOS.maxLat && lng >= LAOS.minLng && lng <= LAOS.maxLng;

/**
 * Click a map, get a pin.
 *
 * Leaflet is driven directly rather than through react-leaflet, the same way
 * the guest app's PropertyMap does it — one imperative library, one ref, one
 * effect. The marker is a divIcon because Leaflet's stock one points at PNGs
 * by a path bundlers rewrite, which 404s.
 *
 * The map is created once and never torn down on a coordinate change: pinning
 * a place is a sequence of small corrections, and rebuilding the map on each
 * click would throw away the pan and zoom the operator just set up.
 */
export function LocationPicker({
  value,
  onChange,
  height = 320,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (next: { lat: number; lng: number }) => void;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pin = useRef<L.Marker | null>(null);
  // Kept in a ref so the click handler, bound once, always sees the live one.
  const emit = useRef(onChange);
  emit.current = onChange;

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || map.current) return;

    const m = L.map(el, {
      center: value ? [value.lat, value.lng] : CENTRE,
      zoom: value ? 16 : 6,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);

    m.on('click', (e: L.LeafletMouseEvent) => {
      emit.current({
        // 7 decimals is what the column stores; more would be discarded and
        // would make the readout look more certain than the data is.
        lat: Number(e.latlng.lat.toFixed(7)),
        lng: Number(e.latlng.lng.toFixed(7)),
      });
    });

    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    setReady(true);

    return () => {
      m.remove();
      map.current = null;
      pin.current = null;
    };
    // Mount only: `value` is read for the initial view and then followed by
    // the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    if (!value) {
      pin.current?.remove();
      pin.current = null;
      return;
    }

    if (!pin.current) {
      const icon = L.divIcon({
        className: '',
        html:
          `<div style="width:20px;height:20px;border-radius:50%;` +
          `background:${c.accent};border:3px solid #fff;` +
          `box-shadow:0 2px 8px rgba(40,30,20,.5)"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      pin.current = L.marker([value.lat, value.lng], { icon, draggable: true }).addTo(m);
      pin.current.on('dragend', () => {
        const p = pin.current!.getLatLng();
        emit.current({ lat: Number(p.lat.toFixed(7)), lng: Number(p.lng.toFixed(7)) });
      });
    } else {
      pin.current.setLatLng([value.lat, value.lng]);
    }
  }, [value, ready]);

  const outside = value && !inLaos(value.lat, value.lng);

  return (
    <div>
      <div
        ref={box}
        data-testid="location-picker"
        style={{
          height,
          width: '100%',
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${c.border}`,
          background: c.bg,
          cursor: 'crosshair',
        }}
      />
      <div style={{ marginTop: 8, font: f(500, 12), color: outside ? c.dangerFg : c.soft }}>
        {value
          ? outside
            ? `${value.lat}, ${value.lng} — ຢູ່ນອກປະເທດລາວ ບັນທຶກບໍ່ໄດ້`
            : `${value.lat}, ${value.lng}`
          : 'ກົດເທິງແຜນທີ່ເພື່ອວາງໝຸດ'}
      </div>
    </div>
  );
}

export default LocationPicker;
