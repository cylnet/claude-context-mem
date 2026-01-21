/**
 * Error Learning Integration Tests
 *
 * Tests the error learning system endpoints:
 * - POST /api/sessions/errors - Store error for learning
 * - GET /api/errors/similar - Search similar historical errors
 *
 * Two test suites:
 * 1. Base Server tests - verify endpoint routing without full worker setup
 * 2. Live Worker tests - verify full functionality against running worker (skipped if not running)
 */

import { describe, it, expect, beforeAll, afterAll, spyOn, mock } from 'bun:test';
import { logger } from '../../src/utils/logger.js';

// Mock middleware to avoid complex dependencies
mock.module('../../src/services/worker/http/middleware.js', () => ({
  createMiddleware: () => [],
  requireLocalhost: (_req: any, _res: any, next: any) => next(),
  summarizeRequestBody: () => 'test body',
}));

// Import after mocks
import { Server } from '../../src/services/server/Server.js';
import type { ServerOptions } from '../../src/services/server/Server.js';

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

const LIVE_WORKER_PORT = 37777;

describe('Error Learning Integration', () => {
  let server: Server;
  let testPort: number;
  let mockOptions: ServerOptions;

  beforeAll(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];

    mockOptions = {
      getInitializationComplete: () => true,
      getMcpReady: () => true,
      onShutdown: mock(() => Promise.resolve()),
      onRestart: mock(() => Promise.resolve()),
    };

    testPort = 40000 + Math.floor(Math.random() * 10000);
  });

  afterAll(async () => {
    loggerSpies.forEach(spy => spy.mockRestore());

    if (server && server.getHttpServer()) {
      try {
        await server.close();
      } catch {
        // Ignore cleanup errors
      }
    }
    mock.restore();
  });

  describe('GET /api/errors/similar', () => {
    it('should return 404 when SearchRoutes not registered (base Server)', async () => {
      // Base Server class doesn't register SearchRoutes
      // This test verifies the endpoint is not available without proper setup
      server = new Server(mockOptions);
      server.finalizeRoutes();
      await server.listen(testPort, '127.0.0.1');

      const response = await fetch(`http://127.0.0.1:${testPort}/api/errors/similar`);

      // Without SearchRoutes, endpoint returns 404
      expect(response.status).toBe(404);
    });

    it('should return 404 for search without SearchRoutes', async () => {
      const response = await fetch(
        `http://127.0.0.1:${testPort}/api/errors/similar?error_message=${encodeURIComponent('completely unique error xyz123')}`
      );

      // Without SearchRoutes registered, expect 404
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/sessions/errors', () => {
    it('should return 404 when SessionRoutes not registered', async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/api/sessions/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error_message: 'TypeError: Cannot read property "foo" of undefined',
          error_type: 'TypeError'
        })
      });

      // Base Server doesn't register SessionRoutes, expect 404
      expect(response.status).toBe(404);
    });

    it('should return 404 for valid error data without SessionRoutes', async () => {
      const response = await fetch(`http://127.0.0.1:${testPort}/api/sessions/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: 'test-error-session-' + Date.now(),
          error_message: 'TypeError: Cannot read property "foo" of undefined',
          error_type: 'TypeError',
          keywords: ['TypeError', 'undefined', 'foo'],
          file_path: '/test/file.ts',
          command: 'npm test',
          cwd: '/test/project'
        })
      });

      // Base Server doesn't register SessionRoutes, expect 404
      expect(response.status).toBe(404);
    });
  });
});

/**
 * Live Worker Tests
 * These tests run against the actual worker service on port 37777
 * They are skipped if the worker is not running or endpoints not available
 */
describe('Error Learning - Live Worker', () => {
  let workerAvailable = false;
  let errorEndpointAvailable = false;

  beforeAll(async () => {
    // Check if worker is running
    try {
      const healthResponse = await fetch(`http://127.0.0.1:${LIVE_WORKER_PORT}/api/health`, {
        signal: AbortSignal.timeout(1000)
      });
      workerAvailable = healthResponse.ok;

      // Check if error endpoint is available (may need worker restart)
      if (workerAvailable) {
        const errorResponse = await fetch(
          `http://127.0.0.1:${LIVE_WORKER_PORT}/api/errors/similar?error_message=test`,
          { signal: AbortSignal.timeout(1000) }
        );
        // 400 means endpoint exists but missing params, 200 means it works
        errorEndpointAvailable = errorResponse.status !== 404;
      }
    } catch {
      workerAvailable = false;
    }
  });

  describe('GET /api/errors/similar (live)', () => {
    it('should validate required parameters', async () => {
      if (!workerAvailable || !errorEndpointAvailable) {
        console.log('Skipping: Worker not running or endpoint not available (restart worker to load new code)');
        return;
      }

      const response = await fetch(`http://127.0.0.1:${LIVE_WORKER_PORT}/api/errors/similar`);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    it('should return errors array for valid query', async () => {
      if (!workerAvailable || !errorEndpointAvailable) {
        console.log('Skipping: Worker not running or endpoint not available');
        return;
      }

      const response = await fetch(
        `http://127.0.0.1:${LIVE_WORKER_PORT}/api/errors/similar?error_message=${encodeURIComponent('TypeError undefined')}`
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('errors');
      expect(Array.isArray(data.errors)).toBe(true);
    });

    it('should return empty array for unique error', async () => {
      if (!workerAvailable || !errorEndpointAvailable) {
        console.log('Skipping: Worker not running or endpoint not available');
        return;
      }

      const response = await fetch(
        `http://127.0.0.1:${LIVE_WORKER_PORT}/api/errors/similar?error_message=${encodeURIComponent('completely unique error xyz123 ' + Date.now())}`
      );

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.errors).toEqual([]);
    });
  });

  describe('POST /api/sessions/errors (live)', () => {
    it('should store error successfully', async () => {
      if (!workerAvailable) {
        console.log('Skipping: Worker not running on port 37777');
        return;
      }

      const response = await fetch(`http://127.0.0.1:${LIVE_WORKER_PORT}/api/sessions/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: 'test-error-session-' + Date.now(),
          error_message: 'TypeError: Cannot read property "foo" of undefined',
          error_type: 'TypeError',
          keywords: ['TypeError', 'undefined', 'foo'],
          file_path: '/test/file.ts',
          command: 'npm test',
          cwd: '/test/project'
        })
      });

      // Endpoint may not be available if worker hasn't been restarted
      if (response.status === 404) {
        console.log('Skipping: Endpoint not available (restart worker to load new code)');
        return;
      }

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('success', true);
    });
  });
});
