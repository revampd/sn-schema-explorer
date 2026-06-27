/**
 * @vitest-environment jsdom
 *
 * Unit tests for the pure HTML builders in src/core/instance-info.js — the
 * single-instance sections and the N-way comparison panel used by the
 * Configuration Data → Instance Data tab. (The module wires the modal on import,
 * hence jsdom.)
 */
import { describe, it, expect } from 'vitest';
import { instanceSectionsHtml, instancesComparisonHtml } from '../../../src/core/instance-info.js';

const SCOPE_A = {
  label: 'prod',
  loaded: true,
  instance: {
    instance_name: 'prod',
    instance_url: 'https://prod.service-now.com/',
    build_name: 'Washington',
    node_count: 2,
    active_plugins: 1569,
    exported_at: '2026-06-27 11:05:53',
    exported_by: 'me@x.io',
  },
  stats: {
    counts: { tables: 9356, fields: 203811, references: 42676 },
    coverage: { avg_fields_per_table: 21.8 },
  },
  capabilities: {},
  build: { builderVersion: '2.0.0' },
  version: 1,
};

const SCOPE_B = {
  label: 'dev',
  loaded: true,
  instance: { instance_name: 'dev', build_name: 'Yokohama' },
  stats: { counts: { tables: 20, fields: 120, references: 32 }, coverage: {} },
  version: 1,
};

describe('instanceSectionsHtml()', () => {
  it('renders identity, runtime, export and the schema stat grid', () => {
    const html = instanceSectionsHtml(SCOPE_A);
    expect(html).toContain('Identity');
    expect(html).toContain('prod');
    expect(html).toContain('Runtime');
    expect(html).toContain('active plugins');
    expect(html).toContain('Export');
    expect(html).toContain('insti-stat-grid');
    expect(html).toContain('9356');
  });

  it('suppresses the stat grid with noStatCards', () => {
    const html = instanceSectionsHtml(SCOPE_A, { noStatCards: true });
    expect(html).toContain('Identity');
    expect(html).not.toContain('insti-stat-grid');
  });

  it('shows the legacy-format warning for a string instance', () => {
    const html = instanceSectionsHtml({ instance: 'old-host' });
    expect(html).toContain('older format');
  });
});

describe('instancesComparisonHtml()', () => {
  it('renders one aligned table with grouped attribute rows and stat deltas', () => {
    const html = instancesComparisonHtml([SCOPE_A, SCOPE_B]);
    expect(html).toContain('prod');
    expect(html).toContain('dev');
    expect(html).toContain('insti-compare');
    expect(html).toContain('Identity'); // group header row
    expect(html).toContain('Schema stats'); // stats group header row
    // dev has fewer tables than the base → down/negative delta present.
    expect(html).toContain('isd-down');
    expect(html).toContain('(-9336)');
  });

  it('supports three or more columns', () => {
    const third = {
      label: 'qa',
      loaded: true,
      instance: { instance_name: 'qa' },
      stats: { counts: { tables: 100 }, coverage: {} },
    };
    const html = instancesComparisonHtml([SCOPE_A, SCOPE_B, third]);
    const headerCols = (html.match(/<th[ >]/g) || []).length;
    expect(headerCols).toBe(4); // blank + 3 instances
    expect(html).toContain('qa');
  });

  it('flags un-loaded (metadata-only) instances and omits their stats', () => {
    const placeholder = {
      label: 'restored',
      loaded: false,
      instance: { instance_name: 'restored', build_name: 'Vancouver' },
      stats: undefined,
    };
    const html = instancesComparisonHtml([SCOPE_A, placeholder]);
    expect(html).toContain('meta only');
    expect(html).toContain('Vancouver');
  });

  it('returns empty string for no scopes', () => {
    expect(instancesComparisonHtml([])).toBe('');
  });
});
