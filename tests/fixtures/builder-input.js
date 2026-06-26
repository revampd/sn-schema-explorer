/**
 * Minimal but comprehensive SchemaBuilder input fixture.
 * Covers: inheritance, references, M2M, DB view, package-private table,
 * duplicate dictionary rows, table-level (empty element) rows, CI relationships.
 */
export const BUILDER_INPUT = {
  sysDbObject: [
    {
      sys_id: 'tid_task',
      name: 'task',
      label: 'Task',
      super_class: null,
      sys_scope: { name: 'global', displayValue: 'Global' },
      is_extendable: true,
      access: null,
    },
    {
      sys_id: 'tid_incident',
      name: 'incident',
      label: 'Incident',
      super_class: { name: 'task', displayValue: 'Task' },
      sys_scope: { name: 'global', displayValue: 'Global' },
      is_extendable: false,
      access: null,
    },
    {
      sys_id: 'tid_change',
      name: 'change_request',
      label: 'Change Request',
      super_class: { name: 'task', displayValue: 'Task' },
      sys_scope: { name: 'global', displayValue: 'Global' },
      is_extendable: false,
      access: null,
    },
    {
      sys_id: 'tid_user',
      name: 'sys_user',
      label: 'User',
      super_class: null,
      sys_scope: { name: 'global', displayValue: 'Global' },
      is_extendable: false,
      access: null,
    },
    {
      sys_id: 'tid_private',
      name: 'sn_sm_secret',
      label: 'Secret',
      super_class: null,
      sys_scope: { name: 'sn_sm', displayValue: 'Secrets Management' },
      is_extendable: false,
      access: 'package_private',
    },
  ],

  sysDictionary: [
    // task fields
    {
      sys_id: 'fid_task_sysid',
      name: 'task',
      element: 'sys_id',
      column_label: 'Sys ID',
      internal_type: { value: 'GUID', displayValue: 'Sys ID (GUID)' },
      reference: null,
      max_length: '32',
      mandatory: false,
      primary: true,
    },
    {
      sys_id: 'fid_task_number',
      name: 'task',
      element: 'number',
      column_label: 'Number',
      internal_type: { value: 'string', displayValue: 'String' },
      reference: null,
      max_length: '40',
      mandatory: false,
      primary: false,
    },
    {
      sys_id: 'fid_task_assigned',
      name: 'task',
      element: 'assigned_to',
      column_label: 'Assigned to',
      internal_type: { value: 'reference', displayValue: 'Reference' },
      reference: { name: 'sys_user', displayValue: 'User' },
      max_length: '32',
      mandatory: false,
      primary: false,
    },
    // Duplicate of sys_id — should be deduplicated (only one field emitted)
    {
      sys_id: 'fid_task_sysid_dup',
      name: 'task',
      element: 'sys_id',
      column_label: 'Sys ID Duplicate',
      internal_type: { value: 'GUID', displayValue: 'Sys ID (GUID)' },
      reference: null,
      max_length: '32',
      mandatory: false,
      primary: true,
    },
    // Table-level row (empty element) — must be skipped
    {
      sys_id: 'fid_task_table',
      name: 'task',
      element: '',
      column_label: '',
      internal_type: { value: 'collection', displayValue: 'Collection' },
      reference: null,
      max_length: '0',
      mandatory: false,
      primary: false,
    },
    // sys_user fields
    {
      sys_id: 'fid_user_sysid',
      name: 'sys_user',
      element: 'sys_id',
      column_label: 'Sys ID',
      internal_type: { value: 'GUID', displayValue: 'Sys ID (GUID)' },
      reference: null,
      max_length: '32',
      mandatory: false,
      primary: true,
    },
    // Reference to unknown table — edge must be skipped
    {
      sys_id: 'fid_task_orphan',
      name: 'task',
      element: 'orphan_ref',
      column_label: 'Orphan Ref',
      internal_type: { value: 'reference', displayValue: 'Reference' },
      reference: { name: 'nonexistent_table', displayValue: 'Nonexistent' },
      max_length: '32',
      mandatory: false,
      primary: false,
    },
  ],

  sysM2m: [
    {
      sys_id: 'm2m_1',
      from_table: 'incident',
      to_table: 'sys_user',
      m2m_table: 'incident_user',
      m2m_from_field: 'incident',
      m2m_to_field: 'user',
      m2m_from_label: 'Incident',
      m2m_to_label: 'User',
    },
  ],

  sysDbView: [
    { sys_id: 'vid_1', name: 'task_view', label: 'Task View', description: '', plural: '' },
  ],

  sysDbViewTable: [
    {
      sys_id: 'vt_1',
      view: { name: 'task_view', displayValue: 'task_view' },
      table: 'task',
      order: '1',
      left_join: false,
      where_clause: '',
      variable_prefix: 't',
      active: true,
    },
  ],

  sysRelationship: [],

  sysGlideObject: [
    {
      sys_id: 'gt_1',
      name: 'GUID',
      label: 'Sys ID (GUID)',
      scalar_type: 'string',
      scalar_length: '32',
      class_name: '',
      visible: true,
      attributes: '',
    },
    {
      sys_id: 'gt_2',
      name: 'string',
      label: 'String',
      scalar_type: 'string',
      scalar_length: '0',
      class_name: '',
      visible: true,
      attributes: '',
    },
    {
      sys_id: 'gt_3',
      name: 'reference',
      label: 'Reference',
      scalar_type: 'string',
      scalar_length: '32',
      class_name: '',
      visible: true,
      attributes: '',
    },
  ],

  // Mirror pair — should collapse to one CI relationship entry.
  // Row 1 (parent=true):  computer IS the parent → parentClass=computer, childClass=adapter
  // Row 2 (parent=false): adapter is NOT the parent → parentClass=computer, childClass=adapter (same key)
  cmdbRelTypeSuggest: [
    {
      base_class: 'cmdb_ci_computer',
      dependent_class: 'cmdb_ci_network_adapter',
      parent: 'true',
      rel_type_display: 'Contains::Contained by',
    },
    {
      base_class: 'cmdb_ci_network_adapter',
      dependent_class: 'cmdb_ci_computer',
      parent: 'false',
      rel_type_display: 'Contains::Contained by',
    },
  ],

  instance: {
    instance_name: 'test-instance',
    export_mode: 'background-script',
    exported_at: '2026-01-01T00:00:00.000Z',
  },
};
