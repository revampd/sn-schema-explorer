/* Shared test helper — install an in-memory localStorage shim.
 *
 * jsdom in this config doesn't expose localStorage. Importing this module (for
 * its side effect) installs a Map-backed shim if one isn't already present, so
 * modules that persist to localStorage work under @vitest-environment jsdom.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
}
