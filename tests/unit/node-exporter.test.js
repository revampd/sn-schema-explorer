/**
 * Unit tests for src/exporter/node/sn-schema-export.node.js
 *
 * The exporter is a CommonJS-authored CLI living in an ESM package, so we load
 * it the same way schema-builder.test.js loads the UMD builder: readFileSync +
 * new Function, injecting a fake `require` and `process`. Because the CLI entry
 * is guarded by `require.main === module` (which is false here), importing the
 * module never validates config or runs main() — we get the exported helpers in
 * isolation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '../../src/exporter/node/sn-schema-export.node.js'),
  'utf8'
).replace(/^#!.*\n/, ''); // strip shebang — invalid inside a Function body

// ── Minimal fake HTTP response (EventEmitter-ish) ──────────────────────────
function makeRes(statusCode, headers, bodyStr) {
  const handlers = {};
  const res = {
    statusCode,
    headers,
    on(ev, h) {
      handlers[ev] = h;
      return res;
    },
  };
  res._fire = () => {
    if (handlers.data) handlers.data(Buffer.from(bodyStr));
    if (handlers.end) handlers.end();
  };
  return res;
}

// `pageFor(offset)` returns { status, headers, body } for each request.
function makeHttpsMock(pageFor) {
  return {
    request(opts, cb) {
      const req = {
        _onError: null,
        on(ev, h) {
          if (ev === 'error') req._onError = h;
          return req;
        },
        setTimeout() {
          return req;
        },
        destroy(err) {
          if (req._onError) req._onError(err);
        },
        end() {
          const url = new URL('https://' + opts.hostname + opts.path);
          const offset = parseInt(url.searchParams.get('sysparm_offset') || '0', 10);
          const { status, headers, body } = pageFor(offset);
          const res = makeRes(status, headers, body);
          cb(res);
          queueMicrotask(() => res._fire());
        },
      };
      return req;
    },
  };
}

// Load the exporter module with injected dependencies.
function loadModule({ argv = ['node', 'export'], env = {}, https } = {}) {
  const moduleObj = { exports: {} };
  const fakeProcess = {
    argv,
    env,
    stdout: { isTTY: false, write() {} },
    exit(code) {
      const err = new Error('process.exit(' + code + ')');
      err._exitCode = code;
      throw err;
    },
  };
  const requireStub = name => {
    if (name === 'https') return https || {};
    if (name === 'http') return {};
    if (name === 'url') return { URL };
    if (name === 'fs') return {};
    if (name === 'path') return {};
    if (name.includes('schema-builder')) return {};
    return {};
  };
  // require.main !== module here, so the CLI guard stays dormant.
  const fn = new Function('module', 'exports', 'require', 'process', SRC);
  fn(moduleObj, moduleObj.exports, requireStub, fakeProcess);
  return moduleObj.exports;
}

describe('parseArgs', () => {
  const { parseArgs } = loadModule();

  it('parses --key=value pairs', () => {
    const out = parseArgs(['node', 's', '--instance=https://x', '--page-size=500']);
    expect(out.instance).toBe('https://x');
    expect(out['page-size']).toBe('500');
  });

  it('treats valueless --flags as boolean true', () => {
    const out = parseArgs(['node', 's', '--pretty', '--verbose']);
    expect(out.pretty).toBe(true);
    expect(out.verbose).toBe(true);
  });

  it('collects positional args under _', () => {
    const out = parseArgs(['node', 's', 'pos1', '--flag', 'pos2']);
    expect(out._).toEqual(['pos1', 'pos2']);
  });

  it('keeps = inside values intact', () => {
    const out = parseArgs(['node', 's', '--query=a=b^c=d']);
    expect(out.query).toBe('a=b^c=d');
  });
});

describe('classifyCountError', () => {
  const { classifyCountError } = loadModule();

  it('classifies 401/403 status as acl', () => {
    expect(classifyCountError('whatever', 401)).toBe('acl');
    expect(classifyCountError('whatever', 403)).toBe('acl');
  });

  it('classifies access/security messages as acl', () => {
    expect(classifyCountError('Security restricted', null)).toBe('acl');
    expect(classifyCountError('access denied', null)).toBe('acl');
    expect(classifyCountError('Restricted caller access', null)).toBe('acl');
  });

  it('classifies aggregate-unsupported messages', () => {
    expect(classifyCountError('Table does not support aggregate', null)).toBe('unsupported');
  });

  it('classifies script errors', () => {
    expect(classifyCountError('TypeError: x', null)).toBe('script_error');
    expect(classifyCountError('ReferenceError', null)).toBe('script_error');
  });

  it('falls back to other', () => {
    expect(classifyCountError('mystery', 500)).toBe('other');
    expect(classifyCountError(null, null)).toBe('other');
  });
});

describe('validateCliConfig — credential handling (H1)', () => {
  it('refuses --password on the command line', () => {
    const mod = loadModule({ argv: ['node', 's', '--instance=x', '--password=secret'] });
    let captured = '';
    const origErr = console.error;
    console.error = m => {
      captured += m;
    };
    try {
      expect(() => mod.validateCliConfig()).toThrow(/process\.exit/);
    } finally {
      console.error = origErr;
    }
    expect(captured).toMatch(/Secrets must not be passed as command-line arguments/);
  });

  it('refuses --apikey on the command line', () => {
    const mod = loadModule({ argv: ['node', 's', '--instance=x', '--apikey=k'] });
    const origErr = console.error;
    console.error = () => {};
    try {
      expect(() => mod.validateCliConfig()).toThrow(/process\.exit/);
    } finally {
      console.error = origErr;
    }
  });

  it('accepts credentials supplied via environment variables', () => {
    const mod = loadModule({
      argv: ['node', 's', '--instance=https://dev.example.com', '--user=admin'],
      env: { SN_PASSWORD: 'secret' },
    });
    expect(() => mod.validateCliConfig()).not.toThrow();
    expect(mod.config.instance).toBe('https://dev.example.com');
  });
});

describe('fetchTableAll — pagination safety cap (H4)', () => {
  it('aborts when the API keeps returning non-empty pages past the expected count', async () => {
    // X-Total-Count says 5 rows; with pageSize 1000 the loop should never run
    // more than ceil(5/1000)+5 = 6 pages. A misbehaving instance that always
    // returns a non-empty page must be aborted.
    const https = makeHttpsMock(() => ({
      status: 200,
      headers: { 'x-total-count': '5' },
      body: JSON.stringify({ result: [{ sys_id: 'x' }] }),
    }));
    const mod = loadModule({
      argv: ['node', 's', '--instance=https://dev.example.com'],
      env: { SN_APIKEY: 'k' },
      https,
    });
    mod.config.instance = 'https://dev.example.com';
    mod.config.apikey = 'k';
    await expect(mod.fetchTableAll('incident', null, null)).rejects.toThrow(/exceeded .* pages/);
  });

  it('returns all rows then stops on the first empty page', async () => {
    const https = makeHttpsMock(offset => ({
      status: 200,
      headers: { 'x-total-count': '2' },
      body: JSON.stringify({ result: offset === 0 ? [{ sys_id: 'a' }, { sys_id: 'b' }] : [] }),
    }));
    const mod = loadModule({
      argv: ['node', 's', '--instance=https://dev.example.com'],
      env: { SN_APIKEY: 'k' },
      https,
    });
    mod.config.instance = 'https://dev.example.com';
    mod.config.apikey = 'k';
    const rows = await mod.fetchTableAll('incident', null, null);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.sys_id)).toEqual(['a', 'b']);
  });
});

describe('response size cap (M6)', () => {
  it('exposes a sane MAX_RESPONSE_BYTES ceiling', () => {
    const { MAX_RESPONSE_BYTES } = loadModule();
    expect(MAX_RESPONSE_BYTES).toBeGreaterThan(10 * 1024 * 1024);
    expect(MAX_RESPONSE_BYTES).toBeLessThanOrEqual(1024 * 1024 * 1024);
  });
});
