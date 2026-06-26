import { diffState, uiState } from '../../core/state.js';
import { render, updateInstancePill } from '../../engine/render.js';

// ── Diff file input wiring ────────────────────────────────────────────────────
//
// Wires the diff sidebar drop-zone + file picker: single-file load, multi-part
// manifest stitching, and the clear button. Diff-internal helpers (which live in
// index.js and close over the module's state machinery) are injected via deps so
// this module needs only the stable core/state + engine/render imports.

export function initDiffFileInput({
  loadDiffSchema,
  diffUngraftAddedFromBase,
  diffUpdateSummary,
  diffBuildList,
}) {
  const dz = document.getElementById('diff-drop-zone');
  const inp = document.getElementById('diff-file-input');
  if (!dz || !inp) return;

  inp.setAttribute('multiple', '');
  const hint = dz.querySelector('.diff-drop-zone-hint');
  if (hint) hint.innerHTML = 'single file <em>or</em> manifest + .part*.json · or tap to browse';

  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', e => {
    loadCompareFileList(e.target.files, e.target.files[0] && e.target.files[0].name);
    inp.value = '';
  });
  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    loadCompareFileList(
      e.dataTransfer.files,
      e.dataTransfer.files[0] && e.dataTransfer.files[0].name
    );
  });

  const clearBtn = document.getElementById('diff-drop-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      diffUngraftAddedFromBase();
      diffState._diffData = null;
      diffState._diffShowAll = false;
      diffState._diffFilter = 'all';
      uiState._viewPositionCache.diff = null;
      diffUpdateSummary();
      diffBuildList();
      const dzText = document.getElementById('diff-dz-text');
      const dzFilename = document.getElementById('diff-dz-filename');
      if (dzText) dzText.textContent = 'Drop compare schema here';
      if (dzFilename) {
        dzFilename.textContent = '';
        dzFilename.style.display = 'none';
      }
      clearBtn.style.display = 'none';
      const modeWarn = document.getElementById('diff-mode-warn');
      if (modeWarn) modeWarn.style.display = 'none';
      updateInstancePill();
      render();
    });
  }

  async function loadCompareFileList(files, displayName) {
    if (!files || !files.length) return;
    const fileArr = Array.from(files);
    const fail = err => alert('Could not load compare schema:\n\n' + (err.message || String(err)));

    function applyCompare(data, label) {
      if (!data.nodes || !data.edges) {
        fail(new Error('Not a valid schema JSON (missing nodes or edges)'));
        return;
      }
      const dzText = document.getElementById('diff-dz-text');
      const dzFilename = document.getElementById('diff-dz-filename');
      if (dzText) dzText.textContent = 'Loaded · drop another to swap';
      if (dzFilename) {
        dzFilename.textContent = label;
        dzFilename.style.display = '';
      }
      const cb = document.getElementById('diff-drop-clear');
      if (cb) cb.style.display = '';
      loadDiffSchema(data);
    }

    if (fileArr.length === 1) {
      const f = fileArr[0];
      const r = new FileReader();
      r.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed && parsed._manifest_version && Array.isArray(parsed.parts)) {
            promptCompareMultiPartLoad(parsed, applyCompare);
            return;
          }
          applyCompare(parsed, f.name);
        } catch (err) {
          fail(err);
        }
      };
      r.readAsText(f);
      return;
    }

    try {
      const byName = new Map(fileArr.map(f => [f.name, f]));
      const manifestFile = fileArr.find(f => /\.manifest\.json$/i.test(f.name));
      if (!manifestFile) {
        fail(new Error('Multiple files but none look like a manifest (*.manifest.json).'));
        return;
      }
      const manifest = JSON.parse(await manifestFile.text());
      if (!manifest._manifest_version || !Array.isArray(manifest.parts)) {
        fail(new Error('Manifest is missing _manifest_version or parts.'));
        return;
      }
      const missing = manifest.parts.map(p => p.fileName).filter(n => !byName.has(n));
      if (missing.length) {
        fail(new Error('Missing part files:\n' + missing.join('\n')));
        return;
      }
      const ordered = manifest.parts.slice().sort((a, b) => a.idx - b.idx);
      const texts = [];
      for (const p of ordered) texts.push(await byName.get(p.fileName).text());
      const parsed = JSON.parse(texts.join(''));
      texts.length = 0;
      applyCompare(parsed, manifestFile.name + ' (+' + manifest.parts.length + ' parts)');
    } catch (err) {
      fail(err);
    }
  }

  function promptCompareMultiPartLoad(manifest, applyCompare) {
    const expected = manifest.parts.map(p => p.fileName).sort();
    const msg =
      `This is a multi-part schema export (${manifest.parts.length} parts, ${(manifest.totalBytes / 1048576).toFixed(1)} MB total).\n\n` +
      `Select all of these part files in the next dialog:\n  ${expected.join('\n  ')}\n\n` +
      `Tip: in the file picker you can multi-select with Ctrl+click (Cmd+click on Mac).`;
    if (!confirm(msg + '\n\nOK to pick the part files now?')) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.multiple = true;
    picker.addEventListener('change', ev => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      const byName = new Map(files.map(f => [f.name, f]));
      const missing = expected.filter(name => !byName.has(name));
      if (missing.length) {
        alert('Missing part files:\n' + missing.join('\n'));
        return;
      }
      (async () => {
        try {
          const ordered = manifest.parts.slice().sort((a, b) => a.idx - b.idx);
          const texts = [];
          for (const p of ordered) texts.push(await byName.get(p.fileName).text());
          const parsed = JSON.parse(texts.join(''));
          texts.length = 0;
          applyCompare(parsed, 'manifest (+' + manifest.parts.length + ' parts)');
        } catch (err) {
          alert('Failed to stitch compare parts: ' + (err.message || err));
        }
      })();
    });
    picker.click();
  }
}
