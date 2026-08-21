import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { UPLOAD_ROOT, UPLOAD_URL_PREFIX } from './uploads/storage.interface';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    // The payment webhook's HMAC is computed over the bytes the provider sent.
    // Re-serialising the parsed JSON would change key order and whitespace, and
    // every signature would fail.
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // The admin panel is a separate origin in development (Vite on :5173) and is
  // served from its own host in production, so CORS is explicit rather than open.
  // The guest web app (:5174) and the partner Flutter app run on Chrome (:5175)
  // are two more. Read from CORS_ORIGIN, which `--watch` does not reload: adding
  // an origin there needs this process restarted, not just saved.
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  });

  // No cross-origin resource policy fuss: this process serves JSON and the
  // uploaded photos, which the apps load from a different origin.
  //
  // The referrer policy is loosened from helmet's `no-referrer` default for
  // the map on the property page: OpenStreetMap's tile usage policy asks that
  // callers identify themselves, and with no referrer at all their operators
  // cannot tell us apart from a scraper. `strict-origin-when-cross-origin`
  // sends `https://phaphak.com/` and nothing more — the tile server learns who
  // is asking, and never which property a guest happens to be looking at.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());

  // Uploaded property and room photos, served outside the /api prefix so the
  // URLs stored in the database stay stable if the API is ever versioned.
  //
  // Only when the photos are actually on this machine. Pointed at a bucket,
  // the app must not also answer /uploads: a stale file left in the local
  // folder would shadow the object the database now names.
  const storageProvider = (config.get<string>('STORAGE_PROVIDER') ?? 'local').toLowerCase();
  if (storageProvider === 'local') {
    mkdirSync(UPLOAD_ROOT, { recursive: true });
    app.useStaticAssets(UPLOAD_ROOT, {
      prefix: UPLOAD_URL_PREFIX,
      // The filenames are random, so a long cache is safe: a given URL's bytes
      // never change.
      maxAge: '30d',
      index: false,
    });
  }

  // The two web apps, served by this same process.
  //
  // Deliberately not on Pages or any other host. Both SPAs call the API at the
  // relative `/api`, and `local-disk.storage.ts` writes the relative
  // `/uploads/<key>` into the database as a photo's public URL — so one origin
  // has to answer all three. Splitting them would mean rewriting every photo
  // URL already stored.
  //
  // `ADMIN_HOST` picks the back office by Host header; everything else gets the
  // guest site. Leave it unset, or leave an app unbuilt, and that app is simply
  // not served — the API still is, which is what development wants.
  const dist = (key: string, name: string): string =>
    config.get<string>(key)?.trim() || join(__dirname, '..', '..', name, 'dist');

  const spa = (dir: string) => {
    // `index: false` so the shell is never served by the static handler: a
    // fresh deploy changes index.html while the hashed assets beside it do not,
    // and a cached shell would ask for the previous build's chunks.
    const files = express.static(dir, { index: false, maxAge: '1h' });
    const shell = join(dir, 'index.html');

    return (req: Request, res: Response, next: NextFunction): void => {
      files(req, res, () => {
        // A miss is not a 404 — the SPA owns its own routing, so `/property/42`
        // has no file behind it and still has to be answered with the shell.
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        res.sendFile(shell, (err: unknown) => {
          if (err) next(err);
        });
      });
    };
  };

  const adminHost = config.get<string>('ADMIN_HOST')?.trim().toLowerCase();
  const guestDir = dist('WEBAPP_DIST', 'webapp');
  const adminDir = dist('WEBADMIN_DIST', 'webadmin');

  const guestSite = existsSync(join(guestDir, 'index.html')) ? spa(guestDir) : null;
  const adminSite = adminHost && existsSync(join(adminDir, 'index.html')) ? spa(adminDir) : null;

  if (guestSite || adminSite) {
    // Registered before Nest mounts its controllers — `listen()` does that —
    // so the API's own prefixes are stepped over explicitly rather than relied
    // on to have matched first. `/uploads` is skipped even when the photos are
    // in a bucket and nothing serves it here: a missing photo must 404, not
    // come back as the guest site's HTML with status 200.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const path = req.path;
      if (path === '/api' || path.startsWith('/api/')) return next();
      if (path === UPLOAD_URL_PREFIX || path.startsWith(`${UPLOAD_URL_PREFIX}/`)) return next();

      const site = adminSite && req.hostname.toLowerCase() === adminHost ? adminSite : guestSite;
      if (!site) return next();
      site(req, res, next);
    });

    const served = [guestSite && 'webapp', adminSite && `webadmin (${adminHost})`].filter(Boolean);
    new Logger('Bootstrap').log(`Serving ${served.join(' and ')}`);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // drop properties with no DTO decorator
      forbidNonWhitelisted: true, // and reject the request that sent them
      transform: true, // "?page=2" becomes the number 2
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Correct client IPs behind Neon/Vercel/nginx, which the audit log records.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const port = Number(config.get<string>('PORT', '3000'));
  // No explicit host: Node binds dual-stack, so "localhost" works whether it
  // resolves to 127.0.0.1 or ::1. Binding 0.0.0.0 is IPv4-only and breaks
  // Node's own fetch on Windows, which prefers ::1.
  await app.listen(port);

  new Logger('Bootstrap').log(`PhaPhak API listening on http://localhost:${port}/api`);
}

void bootstrap();
