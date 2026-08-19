import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { c, f, radius } from '../theme';

/**
 * A property's location on an OpenStreetMap.
 *
 * Leaflet is driven directly rather than through react-leaflet, the same way
 * QrCode.tsx drives its canvas: one imperative library, one ref, one effect —
 * a React wrapper around it would be a second dependency to keep in step with
 * React 19 for no behaviour we need.
 *
 * This module is loaded lazily (see Property.tsx). Both the library and the
 * stylesheet are imported here rather than in main.tsx so Vite keeps them in
 * the split chunk; pulled into the entry they would land on every page,
 * including the ones with no map, for about 45 kB gzipped.
 */
export function PropertyMap({
  lat,
  lng,
  name,
  height = 260,
}: {
  lat: number;
  lng: number;
  name: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    const map = L.map(el, {
      center: [lat, lng],
      zoom: 16,
      // A map that eats the wheel is a trap on a phone: the page stops
      // scrolling the moment a thumb lands on it. Zooming turns on once the
      // reader has deliberately clicked into the map.
      scrollWheelZoom: false,
      // Nothing here is worth a second network request on a slow connection.
      zoomControl: true,
      attributionControl: true,
    });
    map.once('focus', () => map.scrollWheelZoom.enable());

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the ODbL, not decoration. Removing it would make our use
      // of the tiles a licence breach.
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // Leaflet's stock marker points at PNG files by a path it computes from
    // the stylesheet's location, which bundlers rewrite and it then 404s — the
    // most common Leaflet-with-Vite bug there is. A divIcon is plain HTML, so
    // there is no asset to lose and it can carry the app's own colour.
    const pin = L.divIcon({
      className: '',
      html:
        `<div style="width:22px;height:22px;border-radius:50%;` +
        `background:${c.accent};border:3px solid #fff;` +
        `box-shadow:0 2px 8px rgba(43,37,33,.45)"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    L.marker([lat, lng], { icon: pin, title: name, keyboard: false }).addTo(map);

    // The container is sized by CSS that may not have settled when Leaflet
    // measured it — a map laid out inside a section that was still growing
    // renders as a single tile in the corner until something forces a resize.
    const settle = setTimeout(() => map.invalidateSize(), 0);

    return () => {
      clearTimeout(settle);
      map.remove();
    };
  }, [lat, lng, name]);

  return (
    <div
      ref={box}
      data-testid="property-map"
      aria-label={`ແຜນທີ່ ${name}`}
      style={{
        height,
        width: '100%',
        borderRadius: radius.lg,
        overflow: 'hidden',
        border: `1px solid ${c.border}`,
        background: c.neutralBg,
        font: f(400, 12),
      }}
    />
  );
}

export default PropertyMap;
