/**
 * Error Detection Utility Tests
 *
 * Tests for Bash error detection and error feature extraction.
 */

import { describe, it, expect } from 'bun:test';
import { detectBashError, extractErrorFeatures } from '../../src/utils/error-detection.js';

describe('error-detection', () => {
  describe('detectBashError', () => {
    it('should detect non-zero exit code', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'Error: command not found\nExit code: 1',
      });
      expect(result.isError).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    it('should detect "exited with code" pattern', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'Process exited with code 127',
      });
      expect(result.isError).toBe(true);
      expect(result.exitCode).toBe(127);
    });

    it('should not flag exit code 0', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'Success\nExit code: 0',
      });
      expect(result.isError).toBe(false);
    });

    it('should not flag successful commands', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'Success output',
      });
      expect(result.isError).toBe(false);
    });

    it('should ignore non-Bash tools', () => {
      const result = detectBashError({
        tool_name: 'Read',
        tool_response: 'Error: file not found',
      });
      expect(result.isError).toBe(false);
    });

    it('should detect error keyword patterns', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'error: something went wrong',
      });
      expect(result.isError).toBe(true);
    });

    it('should detect npm ERR! pattern', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'npm ERR! code ENOENT',
      });
      expect(result.isError).toBe(true);
    });

    it('should detect failed keyword', () => {
      const result = detectBashError({
        tool_name: 'Bash',
        tool_response: 'Build failed',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('extractErrorFeatures', () => {
    it('should extract error type from TypeError', () => {
      const features = extractErrorFeatures('TypeError: Cannot read property');
      expect(features.errorType).toBe('TypeError');
    });

    it('should extract error type from SyntaxError', () => {
      const features = extractErrorFeatures('SyntaxError: Unexpected token');
      expect(features.errorType).toBe('SyntaxError');
    });

    it('should extract npm error', () => {
      const features = extractErrorFeatures('npm ERR! code ENOENT');
      expect(features.errorType).toBe('npm');
      expect(features.keywords).toContain('ENOENT');
    });

    it('should extract file path', () => {
      const features = extractErrorFeatures('Error: Cannot find /usr/local/bin/node');
      expect(features.filePath).toBe('/usr/local/bin/node');
    });

    it('should extract multiple keywords', () => {
      const features = extractErrorFeatures('EACCES: permission denied EPERM');
      expect(features.keywords).toContain('EACCES');
      expect(features.keywords).toContain('EPERM');
    });

    it('should return unknown for unrecognized error types', () => {
      const features = extractErrorFeatures('Some random error message');
      expect(features.errorType).toBe('unknown');
    });

    it('should filter out short keywords', () => {
      const features = extractErrorFeatures('ERR ABC LONGCODE');
      // ERR and ABC are 3 chars, should be filtered
      expect(features.keywords).not.toContain('ERR');
      expect(features.keywords).not.toContain('ABC');
      expect(features.keywords).toContain('LONGCODE');
    });
  });
});
