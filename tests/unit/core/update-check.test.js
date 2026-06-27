/**
 * Unit tests for the version comparison in src/core/update-check.js (#45).
 *
 * Only the pure isNewerVersion() is tested — the network/DOM init path depends on
 * fetch + the build-injected __APP_VERSION__ and is exercised manually.
 */
import { describe, it, expect, vi } from 'vitest';

// update-check imports Settings (DOM-heavy) at module load; mock it so the import
// resolves in a node context.
vi.mock('../../../src/modules/settings/index.js', () => ({
  Settings: { isEnabled: () => true },
}));

import { isNewerVersion } from '../../../src/core/update-check.js';

describe('isNewerVersion', () => {
  it('detects a newer patch / minor / major', () => {
    expect(isNewerVersion('1.0.2', '1.0.1')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns false for equal or older versions', () => {
    expect(isNewerVersion('1.0.1', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.2.0', '1.10.0')).toBe(false);
  });

  it('tolerates a leading v and missing parts', () => {
    expect(isNewerVersion('v1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.1', '1.0.5')).toBe(true);
    expect(isNewerVersion('v2', 'v1.9.9')).toBe(true);
  });

  it('never nags on malformed input', () => {
    expect(isNewerVersion('', '1.0.0')).toBe(false);
    expect(isNewerVersion(null, '1.0.0')).toBe(false);
    expect(isNewerVersion('latest', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', undefined)).toBe(false);
  });
});
