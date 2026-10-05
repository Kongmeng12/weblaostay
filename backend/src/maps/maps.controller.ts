import { BadRequestException, Controller, Get, Logger, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators';

/**
 * Proxies MapTiler tiles for the property-location preview.
 *
 * The client never talks to MapTiler directly: the key stays server-side
 * (never shipped in a native binary or a web JS bundle), and MapTiler's
 * per-key restriction only has to name this server's own User-Agent —
 * one rule that covers Android, iOS, Windows and every web origin at once,
 * instead of juggling an origin allowlist per deployment.
 */
@Controller('maps')
export class MapsController {
  private readonly logger = new Logger(MapsController.name);

  constructor(private readonly config: ConfigService) {}

  // Public, so it is also unauthenticated bandwidth against the free-tier
  // MapTiler quota: one caller hammering /maps/tile could exhaust the key for
  // everyone. The per-route cap sits well above a map pan/zoom burst (a screen
  // of tiles is a few dozen requests) but far below what a scraper would want.
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('tile/:z/:x/:y.png')
  async tile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: Response,
  ): Promise<void> {
    // z/x/y land in the upstream URL, so they are held to the digits a tile
    // coordinate is — nothing else can reach api.maptiler.com through here.
    if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) {
      throw new BadRequestException('ພິກັດ tile ບໍ່ຖືກຕ້ອງ · Invalid tile coordinate');
    }

    const key = this.config.get<string>('MAPTILER_API_KEY')?.trim();
    if (!key) {
      res.status(503).end();
      return;
    }

    const upstreamUrl = `https://api.maptiler.com/maps/streets-v2/${z}/${x}/${y}.png?key=${key}`;

    let upstream: Response2;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { 'User-Agent': 'https://www.phaphak.com/' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.warn(`Tile fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(502).end();
      return;
    }

    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    // Tiles at a given z/x/y never change, so a long cache saves both this
    // server's bandwidth and the free-tier MapTiler quota on repeat views.
    res.set('Content-Type', upstream.headers.get('content-type') ?? 'image/png');
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}

// `fetch`'s Response, aliased to avoid colliding with Express's Response above.
type Response2 = globalThis.Response;
