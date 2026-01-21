/**
 * Error Detection Utilities
 *
 * Detects errors in Bash command outputs and extracts error features
 * for vector search matching in the error learning system.
 */

import { logger } from './logger.js';

export interface ErrorDetectionResult {
  isError: boolean;
  errorMessage?: string;
  exitCode?: number;
}

export interface ErrorFeatures {
  errorType: string;
  keywords: string[];
  filePath?: string;
}

const EXIT_CODE_PATTERNS = [
  /exit code[:\s]+(\d+)/i,
  /exited with code (\d+)/i,
  /returned (\d+)/i,
];

const ERROR_KEYWORD_PATTERNS = [
  /error:/i,
  /ERR!/i,
  /(?:build|test|command|process|task|job|compilation)\s+failed/i,
  /exception/i,
];

const ERROR_TYPE_PATTERNS: [RegExp, string][] = [
  [/TypeError/i, 'TypeError'],
  [/SyntaxError/i, 'SyntaxError'],
  [/ReferenceError/i, 'ReferenceError'],
  [/ModuleNotFoundError/i, 'ModuleNotFoundError'],
  [/npm ERR!/i, 'npm'],
  [/pip.*error/i, 'pip'],
  [/cargo.*error/i, 'cargo'],
  [/tsc.*error/i, 'typescript'],
];

export function detectBashError(input: {
  tool_name: string;
  tool_response: unknown;
}): ErrorDetectionResult {
  if (input.tool_name !== 'Bash') {
    return { isError: false };
  }

  // Ensure response is a string
  const response = typeof input.tool_response === 'string'
    ? input.tool_response
    : JSON.stringify(input.tool_response ?? '');

  // Check for non-zero exit code
  for (const pattern of EXIT_CODE_PATTERNS) {
    const match = response.match(pattern);
    if (match && parseInt(match[1]) !== 0) {
      return {
        isError: true,
        errorMessage: response,
        exitCode: parseInt(match[1]),
      };
    }
  }

  // Check for error keywords
  for (const pattern of ERROR_KEYWORD_PATTERNS) {
    if (pattern.test(response)) {
      logger.debug('SYSTEM', 'error keyword detected', undefined, { pattern: pattern.source });
      return {
        isError: true,
        errorMessage: response,
      };
    }
  }

  return { isError: false };
}

export function extractErrorFeatures(errorMessage: string): ErrorFeatures {
  let errorType = 'unknown';

  for (const [pattern, type] of ERROR_TYPE_PATTERNS) {
    if (pattern.test(errorMessage)) {
      errorType = type;
      break;
    }
  }

  // Extract keywords (error codes like ENOENT, EACCES, etc.)
  const keywords: string[] = [];
  const codeMatch = errorMessage.match(/\b([A-Z][A-Z0-9_]+)\b/g);
  if (codeMatch) {
    keywords.push(...codeMatch.filter((k) => k.length > 3));
  }

  // Extract file path
  const pathMatch = errorMessage.match(/(?:\/[\w.-]+)+(?:\.\w+)?/);
  const filePath = pathMatch?.[0];

  return { errorType, keywords, filePath };
}
