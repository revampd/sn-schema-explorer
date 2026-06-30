import { graphState } from './state.js';

// ── Field type → badge colour / label ─────────────────────────────────────────
//
// Maps a ServiceNow field type to a swatch colour (for the in-node field badges
// and the inspector) and to a human label. Extracted verbatim from render.js
// (#73); pure aside from reading graphState.graphData._typeCatalog for instance-
// specific scalar fallbacks. render.js re-exports typeBadgeColor / typeLabel so
// existing importers keep resolving them from there.

const TYPE_BADGE_COL_RAW = {
  string: '#cdd9e5',
  sys_id_guid: '#cdd9e5',
  sys_id: '#cdd9e5',
  ip_address: '#cdd9e5',
  ip_address_validated_ipv4_ipv6: '#cdd9e5',
  table_name: '#cdd9e5',
  url: '#cdd9e5',
  email: '#cdd9e5',
  password: '#cdd9e5',
  password_2_way_encrypted: '#cdd9e5',
  string_full_utf_8: '#cdd9e5',
  long_integer_string: '#cdd9e5',
  translated_text: '#cdd9e5',
  translated_field: '#cdd9e5',
  char: '#cdd9e5',
  wikitext: '#cdd9e5',
  mid_config: '#cdd9e5',
  two_line_text_area: '#cdd9e5',
  phone_number: '#cdd9e5',
  phone_number_e164: '#cdd9e5',
  short_table_name: '#cdd9e5',
  ph_number: '#cdd9e5',
  name_value_pairs: '#cdd9e5',
  integer: '#ffd166',
  long: '#ffd166',
  decimal: '#ffd166',
  floating_point_number: '#ffd166',
  float: '#ffd166',
  double: '#ffd166',
  percent_complete: '#ffd166',
  currency: '#ffd166',
  fx_currency: '#ffd166',
  price: '#ffd166',
  auto_increment: '#ffd166',
  order: '#ffd166',
  counter: '#ffd166',
  numeric: '#ffd166',
  integer_string: '#ffd166',
  boolean: '#06d6a0',
  true_false: '#06d6a0',
  reference: '#a090ff',
  document_id: '#a090ff',
  field_name: '#a090ff',
  field_list: '#a090ff',
  list: '#a090ff',
  glide_list: '#a090ff',
  glide_date_time: '#ff9f5a',
  date_time: '#ff9f5a',
  glide_date: '#ff9f5a',
  date: '#ff9f5a',
  glide_time: '#ff9f5a',
  time: '#ff9f5a',
  duration: '#ff9f5a',
  scheduled_date_time: '#ff9f5a',
  due_date: '#ff9f5a',
  days_of_week: '#ff9f5a',
  week_of_month: '#ff9f5a',
  month_of_year: '#ff9f5a',
  integer_date: '#ff9f5a',
  other_date: '#ff9f5a',
  basic_date_time: '#ff9f5a',
  choice: '#7fbfff',
  conditions: '#7fbfff',
  condition_string: '#7fbfff',
  html: '#888',
  translated_html: '#888',
  image: '#888',
  user_image: '#888',
  user_roles: '#888',
  journal: '#888',
  journal_input: '#888',
  journal_list: '#888',
  glyph_icon_bootstrap: '#888',
  script: '#f77',
  script_plain: '#f77',
  script_server: '#f77',
  script_client: '#f77',
  json: '#f77',
  xml: '#f77',
  css: '#f77',
  template_value: '#f77',
  email_script: '#f77',
  glide_var: '#f77',
  compressed: '#f77',
  domain_id: '#a8a8a8',
  domain_path: '#a8a8a8',
  system_class_name: '#a8a8a8',
  system_class_path: '#a8a8a8',
  sys_class_name: '#a8a8a8',
  sys_class_path: '#a8a8a8',
  ui_action_list: '#7fbfff',
  slush_bucket: '#7fbfff',
  breakdown_element: '#7fbfff',
  color: '#c46aff',
};

function normaliseType(t) {
  if (!t) return '';
  return String(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function _hashColor(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const hue = h % 360;
  return `oklch(72% 0.13 ${hue})`;
}

export function typeBadgeColor(t) {
  const key = normaliseType(t);
  if (TYPE_BADGE_COL_RAW[key]) return TYPE_BADGE_COL_RAW[key];
  if (graphState.graphData && graphState.graphData._typeCatalog) {
    const cat =
      graphState.graphData._typeCatalog[key] ||
      graphState.graphData._typeCatalog[String(t)] ||
      graphState.graphData._typeCatalog[t];
    if (cat && cat.scalarType) {
      const scalarKey = normaliseType(cat.scalarType);
      if (TYPE_BADGE_COL_RAW[scalarKey]) return TYPE_BADGE_COL_RAW[scalarKey];
    }
  }
  return _hashColor(key || String(t || ''));
}

export function typeLabel(t) {
  if (!t) return '';
  if (graphState.graphData && graphState.graphData._typeCatalog) {
    const key = normaliseType(t);
    const cat =
      graphState.graphData._typeCatalog[key] ||
      graphState.graphData._typeCatalog[String(t)] ||
      graphState.graphData._typeCatalog[t];
    if (cat && cat.label) return cat.label;
  }
  return String(t);
}
