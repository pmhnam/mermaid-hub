import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  const wsAdapter = new WsAdapter(app);
  const create = wsAdapter.create.bind(wsAdapter);
  wsAdapter.create = (port, options = {}) =>
    create(port, {
      ...options,
      maxPayload: config.get<number>(
        'COLLABORATION_MAX_MESSAGE_BYTES',
        1048576,
      ),
    });
  app.useWebSocketAdapter(wsAdapter);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Diagram API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/openapi',
    app,
    SwaggerModule.createDocument(app, openApiConfig),
  );

  await app.listen(config.get<number>('PORT', 3000));
}
await bootstrap();
