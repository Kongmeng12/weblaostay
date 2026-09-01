import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedPlace {
  name: string;
  lat: number;
  lng: number;
}

interface AttractionRow {
  name_lo: string;
  name_en: string | null;
  latitude: unknown;
  longitude: unknown;
}

/**
 * Turns a search query like "Kuang Si Falls" into coordinates, so
 * `CatalogService.search()` can fall back to a nearby-stays query when the
 * text itself matches no property directly.
 *
 * Hybrid, cheapest-first:
 * 1. The `attractions` table — hand-curated landmarks plus anything a past
 *    query has already resolved via step 2. Free, instant, no network call.
 * 2. MapTiler's geocoding API, scoped to Laos. A hit here is written back
 *    into `attractions` (`source: 'geocoded'`) keyed by *this exact query
 *    text*, so the identical search never geocodes twice — the table grows
 *    on top of the curated seed as real queries come in.
 *
 * Every step is failure-isolated: this never throws. A landmark that fails
 * to resolve is exactly the same, from the caller's point of view, as a
 * search that legitimately has zero results.
 */
@Injectable()
export class PlaceResolverService {
  private readonly logger = new Logger(PlaceResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async resolve(query: string): Promise<ResolvedPlace | null> {
    const trimmed = query.trim();
    if (!trimmed) return null;

    try {
      const local = await this.matchLocal(trimmed);
      if (local) return local;
    } catch (err) {
      this.logger.warn(`Local attraction lookup failed: ${message(err)}`);
    }

    try {
      return await this.geocode(trimmed);
    } catch (err) {
      this.logger.warn(`Geocoding fallback failed: ${message(err)}`);
      return null;
    }
  }

  private async matchLocal(query: string): Promise<ResolvedPlace | null> {
    const slug = slugify(query);

    // `slug = current query's slug` first so an exact repeat of a past
    // geocoded query always hits cache, even if the returned place name
    // (what name_lo/name_en actually hold) reads differently from what was
    // typed. ILIKE/trigram similarity below is what lets a *different*
    // phrasing of a curated landmark's name still match.
    const rows = await this.prisma.$queryRaw<AttractionRow[]>`
      SELECT name_lo, name_en, latitude, longitude
      FROM attractions
      WHERE slug = ${slug}
         OR name_lo ILIKE '%' || ${query} || '%'
         OR name_en ILIKE '%' || ${query} || '%'
         OR similarity(name_lo, ${query}) > 0.3
         OR similarity(coalesce(name_en, ''), ${query}) > 0.3
      ORDER BY
        (slug = ${slug}) DESC,
        GREATEST(similarity(name_lo, ${query}), similarity(coalesce(name_en, ''), ${query})) DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    return {
      name: row.name_en ?? row.name_lo,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    };
  }

  /**
   * MapTiler geocoding — same key, fetch/timeout/User-Agent conventions as
   * the tile proxy in maps.controller.ts. Bounded to a 5s timeout (shorter
   * than the tile proxy's 10s): this sits inline in a live search request,
   * so a slow or dead geocoder should degrade to "no results" quickly
   * rather than stall the page.
   */
  private async geocode(query: string): Promise<ResolvedPlace | null> {
    const key = this.config.get<string>('MAPTILER_API_KEY')?.trim();
    if (!key) return null;

    // bbox is Laos' bounding box, so a query never resolves to a
    // same-named place in another country.
    const url =
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
      `?key=${key}&bbox=100.0,13.9,107.7,22.6&language=lo,en&limit=1`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'https://www.phaphak.com/' },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      this.logger.warn(`Geocoding fetch failed: ${message(err)}`);
      return null;
    }
    if (!res.ok) return null;

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return null;
    }

    const feature = (body as { features?: unknown[] })?.features?.[0] as
      | { center?: unknown; text?: string; place_name?: string }
      | undefined;
    const center = feature?.center;
    if (!Array.isArray(center) || center.length !== 2) return null;
    const [lng, lat] = center as [number, number];
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    const name = feature?.text ?? feature?.place_name ?? query;

    await this.cacheGeocoded(query, name, lat, lng);

    return { name, lat, lng };
  }

  private async cacheGeocoded(query: string, name: string, lat: number, lng: number): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO attractions (name_lo, name_en, slug, latitude, longitude, source)
        VALUES (${name}, ${name}, ${slugify(query)}, ${lat}, ${lng}, 'geocoded')
        ON CONFLICT (slug) DO NOTHING
      `;
    } catch (err) {
      // The resolved coordinates are still good even if the cache write
      // failed (a race with another request geocoding the same query,
      // most likely) — this must not stop the result from being returned.
      this.logger.warn(`Could not cache geocoded attraction: ${message(err)}`);
    }
  }
}

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
