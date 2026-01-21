/**
 * Observation Handler - PostToolUse
 *
 * Extracted from save-hook.ts - sends tool usage to worker for storage.
 */

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { ensureWorkerRunning, getWorkerPort } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { detectBashError, extractErrorFeatures } from '../../utils/error-detection.js';

export const observationHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Ensure worker is running before any other logic
    await ensureWorkerRunning();

    const { sessionId, cwd, toolName, toolInput, toolResponse } = input;

    if (!toolName) {
      throw new Error('observationHandler requires toolName');
    }

    const port = getWorkerPort();

    const toolStr = logger.formatTool(toolName, toolInput);

    logger.dataIn('HOOK', `PostToolUse: ${toolStr}`, {
      workerPort: port
    });

    // Validate required fields before sending to worker
    if (!cwd) {
      throw new Error(`Missing cwd in PostToolUse hook input for session ${sessionId}, tool ${toolName}`);
    }

    // Send to worker - worker handles privacy check and database operations
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentSessionId: sessionId,
        tool_name: toolName,
        tool_input: toolInput,
        tool_response: toolResponse,
        cwd
      })
      // Note: Removed signal to avoid Windows Bun cleanup issue (libuv assertion)
    });

    if (!response.ok) {
      throw new Error(`Observation storage failed: ${response.status}`);
    }

    logger.debug('HOOK', 'Observation sent successfully', { toolName });

    // Detect and store errors for learning system
    const errorResult = detectBashError({
      tool_name: toolName,
      tool_response: toolResponse || ''
    });

    if (errorResult.isError) {
      const features = extractErrorFeatures(errorResult.errorMessage || '');

      // Store error (fire-and-forget)
      fetch(`http://127.0.0.1:${port}/api/sessions/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          error_message: errorResult.errorMessage,
          error_type: features.errorType,
          keywords: features.keywords,
          file_path: features.filePath,
          command: toolInput,
          cwd
        })
      }).catch(err => {
        logger.debug('HOOK', 'Error storage failed', { error: err.message });
      });

      // Query similar errors and inject context
      try {
        const similarResponse = await fetch(
          `http://127.0.0.1:${port}/api/errors/similar?error_message=${encodeURIComponent(errorResult.errorMessage || '')}`
        );
        if (similarResponse.ok) {
          const { errors } = await similarResponse.json();
          if (errors && errors.length > 0) {
            const context = errors
              .map((e: any) => `- **${e.metadata?.title || 'Error'}**`)
              .join('\n');
            console.log(`\n## 相关历史错误\n${context}\n`);
          }
        }
      } catch (err) {
        // Silent fail - don't block main flow
        logger.debug('HOOK', 'Similar error query failed', { error: (err as Error).message });
      }
    }

    return { continue: true, suppressOutput: true };
  }
};
