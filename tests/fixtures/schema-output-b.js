/**
 * Second schema fixture for Schema Diff E2E tests (#38).
 *
 * Derived from SCHEMA_OUTPUT with three deliberate differences vs. the base:
 *   - ADDED:   a new `problem` table
 *   - CHANGED: `task` gains a `priority` field
 *   - (sys_user / incident unchanged)
 *
 * Built as a deep clone + mutation so it stays in sync with the base shape.
 */
import { SCHEMA_OUTPUT } from './schema-output.js';

const clone = JSON.parse(JSON.stringify(SCHEMA_OUTPUT));

// CHANGED: add a field to `task`
const task = clone.nodes.find(n => n.id === 'task');
task.fields.push({
  name: 'priority',
  label: 'Priority',
  type: 'integer',
  typeLabel: 'Integer',
  mandatory: false,
  maxLength: 40,
  primary: false,
  reference: null,
});

// ADDED: a brand-new table not present in the base
clone.nodes.push({
  id: 'problem',
  label: 'Problem',
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
});

clone._instance = {
  ...clone._instance,
  instance_name: 'test-instance-b',
  instance_url: 'https://test-b.service-now.com',
};

export const SCHEMA_OUTPUT_B = clone;
