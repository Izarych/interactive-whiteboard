import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const server = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'loopback') server.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: process.env.NODE_ENV === 'production' ? { maxAge: 31536000 } : false }));
  app.use(json({ limit: '10mb' }));
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const originMismatch = request.headers.origin && request.headers.origin !== webOrigin;
    const crossSite = request.headers['sec-fetch-site'] === 'cross-site';
    const missingBrowserOrigin = request.headers.cookie && !request.headers.origin && process.env.REQUIRE_ORIGIN === 'true';
    if (write && (originMismatch || crossSite || missingBrowserOrigin)) {
      response.status(403).json({ message: 'Запрос с этого сайта не разрешён' });
      return;
    }
    next();
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port = process.env.PORT ?? 3000;
  if (process.env.NODE_ENV === 'production' && (process.env.COOKIE_SECURE !== 'true' || !webOrigin.startsWith('https://'))) throw new Error('Production requires HTTPS and secure cookies');
  await app.listen(port, process.env.HOST ?? '0.0.0.0');
  console.log(`API listening on http://localhost:${port}/api`);
}

void bootstrap();
