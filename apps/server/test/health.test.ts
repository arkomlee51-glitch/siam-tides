import { describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

describe('GET /health', () => {
  it('reports ok and the engine version', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, engine: '0.1.0' });
    await app.close();
  });
});
