import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { DataSource } from 'typeorm';

describe('AppController', () => {
  let appController: AppController;
  const dataSource = { query: vi.fn() };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: DataSource, useValue: dataSource }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('reports database readiness', async () => {
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(appController.health()).resolves.toEqual({
        status: 'ok',
        checks: { database: 'up' },
      });
    });

    it('reports database failure without exposing its error', async () => {
      dataSource.query.mockRejectedValueOnce(
        new Error('secret connection URL'),
      );
      await expect(appController.health()).rejects.toMatchObject({
        response: { status: 'error', checks: { database: 'down' } },
      });
    });
  });
});
