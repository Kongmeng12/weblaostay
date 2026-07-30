import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // The admin panel is a separate origin in development (Vite on :5173) and is
  // served from its own host in production, so CORS is explicit rather than open.
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  });

  // No cross-origin resource policy fuss: this process serves JSON only.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

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

  new Logger('Bootstrap').log(`LaoStay API listening on http://localhost:${port}/api`);
}

void bootstrap();
