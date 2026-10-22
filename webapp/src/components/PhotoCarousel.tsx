import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Images, Pause, Play } from 'lucide-react';
import { c, f, radius } from '../theme';
import { Photo } from './ui';

/** Booking.com, Agoda and most hotel sites hold each photo for about five seconds. */
const INTERVAL_MS = 5000;

/**
 * A property's photos, one at a time, moving on by themselves.
 *
 * The rules international sites follow, and WCAG 2.2.2 asks for when content
 * moves on its own:
 *  - a photo every five seconds, sliding rather than cutting;
 *  - paused while the pointer is over it or focus is inside it, and while the
 *    tab is in the background;
 *  - stopped for good once the guest swipes or uses the arrows — from then on
 *    they are driving, and a slide moving under their finger is a fight;
 *  - never moving for someone whose system asks for reduced motion;
 *  - a pause / play button, so stopping it never depends on a mouse.
 *
 * Built on scroll-snap, so a swipe on a phone and a trackpad on a laptop move
 * it natively. Tapping a photo opens the full-screen gallery at that photo.
 */
export function PhotoCarousel({
  images,
  alt,
  onOpen,
}: {
  images: string[];
  alt: string;
  onOpen: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [stopped, setStopped] = useState(() => prefersReducedMotion());
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const many = images.length > 1;

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!many || stopped || hovered || hidden) return;
    const id = window.setInterval(() => go((current() + 1) % images.length), INTERVAL_MS);
    return () => window.clearInterval(id);
    // `go` and `current` read the DOM, not state, so they never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, stopped, hovered, hidden, images.length]);

  function current() {
    const el = track.current;
    return el ? Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) : 0;
  }

  function go(i: number) {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /** The guest moved it themselves: autoplay is over for this visit. */
  function takeOver() {
    setStopped(true);
  }

  const list = images.length ? images : [''];

  return (
    <div
      className="phaphak-hero"
      role="region"
      aria-roledescription="carousel"
      aria-label={`ຮູບພາບ ${alt}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{ position: 'relative', overflow: 'hidden', background: c.placeholderBg }}
    >
      <div
        ref={track}
        className="phaphak-strip"
        onScroll={() => setIndex(current())}
        onPointerDown={takeOver}
        onWheel={(e) => Math.abs(e.deltaX) > Math.abs(e.deltaY) && takeOver()}
        style={{ display: 'flex', height: 'clamp(260px, 52vw, 460px)' }}
      >
        {list.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={() => url && onOpen(i)}
            aria-label={url ? `ເປີດຮູບທີ ${i + 1} ຈາກ ${images.length}` : alt}
            aria-hidden={i !== index}
            tabIndex={i === index ? 0 : -1}
            style={{
              flex: '0 0 100%',
              height: '100%',
              padding: 0,
              border: 'none',
              background: 'none',
              scrollSnapAlign: 'start',
              cursor: url ? 'zoom-in' : 'default',
            }}
          >
            <Photo url={url || null} alt={i === 0 ? alt : ''} height="100%" rounded={0} />
          </button>
        ))}
      </div>

      {many && (
        <>
          <Arrow side="left" label="ຮູບກ່ອນໜ້າ" onClick={() => { takeOver(); go((index - 1 + images.length) % images.length); }} />
          <Arrow side="right" label="ຮູບຖັດໄປ" onClick={() => { takeOver(); go((index + 1) % images.length); }} />

          {/* Dots for a short set; past ten they stop being countable. */}
          {images.length <= 10 && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 14,
                display: 'flex',
                justifyContent: 'center',
                gap: 6,
                pointerEvents: 'none',
              }}
            >
              {images.map((_, i) => (
                <span
                  key={i}
                  style={{
                    height: 6,
                    width: i === index ? 18 : 6,
                    borderRadius: 3,
                    background: i === index ? '#fff' : 'rgba(255,255,255,.55)',
                    boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                    transition: 'width .25s ease, background .25s ease',
                  }}
                />
              ))}
            </div>
          )}

          <div style={{ position: 'absolute', right: 12, bottom: 10, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setStopped((s) => !s)}
              aria-label={stopped ? 'ເລື່ອນຮູບອັດຕະໂນມັດ' : 'ຢຸດເລື່ອນຮູບ'}
              style={chip}
            >
              {stopped ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => onOpen(index)} style={{ ...chip, padding: '0 12px', gap: 6 }}>
              <Images size={14} aria-hidden="true" />
              <span aria-live="polite">
                {index + 1} / {images.length}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Arrow({ side, label, onClick }: { side: 'left' | 'right'; label: string; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className="phaphak-hero-arrow"
      onClick={onClick}
      aria-label={label}
      style={{
        position: 'absolute',
        top: '50%',
        [side]: 14,
        transform: 'translateY(-50%)',
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(255,255,255,.92)',
        color: c.text,
        boxShadow: '0 2px 10px rgba(0,0,0,.18)',
        placeItems: 'center',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}

const chip: React.CSSProperties = {
  height: 32,
  minWidth: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: radius.pill,
  background: 'rgba(0,0,0,.55)',
  color: '#fff',
  font: f(600, 12, 18),
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
