/**
 * Pre-built schema output fixture in viewer format.
 * Used by E2E tests to load a schema without running the exporter.
 * Small enough to render quickly; covers extends, reference, and M2M edges.
 */
export const SCHEMA_OUTPUT = {
  _schema_version: 1,
  _instance: {
    instance_name: 'test-instance',
    instance_url: 'https://test.service-now.com',
    export_mode: 'background-script',
    exported_at: '2026-01-01T00:00:00.000Z',
    exported_by: 'admin',
    build_name: 'Xanadu',
    build_tag: 'glide-xanadu-12-10-2024__patch1',
    build_date: '12-10-2024',
  },
  _stats: {
    counts: {
      tables: 3,
      fields: 5,
      references: 1,
      m2m_relationships: 0,
      db_views: 0,
      unique_scopes: 1,
      extends_edges: 1,
    },
    coverage: {
      tables_with_references_pct: 33.3,
      avg_fields_per_table: 1.7,
      deepest_inheritance_chain: 1,
    },
    scopes: { Global: 3 },
  },
  _typeCatalog: {},
  _restrictedHints: { packagePrivateTables: [] },
  _ciRelationships: [],
  _capabilities: { recordCounts: { enabled: false } },
  _build: { startedAt: '2026-01-01T00:00:00.000Z', elapsedMs: 1234, builderVersion: '2.0.0' },
  nodes: [
    {
      id: 'task',
      label: 'Task',
      scope: 'Global',
      access: null,
      fields: [
        {
          name: 'sys_id',
          label: 'Sys ID',
          type: 'GUID',
          typeLabel: 'Sys ID (GUID)',
          mandatory: false,
          maxLength: 32,
          primary: true,
          reference: null,
        },
        {
          name: 'number',
          label: 'Number',
          type: 'string',
          typeLabel: 'String',
          mandatory: false,
          maxLength: 40,
          primary: false,
          reference: null,
        },
        {
          name: 'assigned_to',
          label: 'Assigned to',
          type: 'reference',
          typeLabel: 'Reference',
          mandatory: false,
          maxLength: 32,
          primary: false,
          reference: 'sys_user',
        },
      ],
    },
    {
      id: 'incident',
      label: 'Incident',
      scope: 'Global',
      access: null,
      fields: [
        {
          name: 'sys_id',
          label: 'Sys ID',
          type: 'GUID',
          typeLabel: 'Sys ID (GUID)',
          mandatory: false,
          maxLength: 32,
          primary: true,
          reference: null,
        },
      ],
    },
    {
      id: 'sys_user',
      label: 'User',
      scope: 'Global',
      access: null,
      fields: [
        {
          name: 'sys_id',
          label: 'Sys ID',
          type: 'GUID',
          typeLabel: 'Sys ID (GUID)',
          mandatory: false,
          maxLength: 32,
          primary: true,
          reference: null,
        },
      ],
    },
  ],
  edges: [
    { source: 'incident', target: 'task', type: 'extends', label: 'extends' },
    {
      source: 'task',
      target: 'sys_user',
      type: 'reference',
      field: 'assigned_to',
      label: 'Assigned to',
    },
  ],
};
