import { Dom, initLateDom } from './dom.js';
import { renderSettingsModal } from '../modules/settings/index.js';

export function initModals() {
  initLateDom();

  // ── Reference modal ───────────────────────────────────────────────────────
  Dom.btnRefGuide.addEventListener('click', () => {
    Dom.refModal.classList.add('visible');
  });
  Dom.btnRefClose.addEventListener('click', () => {
    Dom.refModal.classList.remove('visible');
  });
  Dom.refModal.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab || !tab.closest('.ref-modal-body')) return;
    const body = document.querySelector('.ref-modal-body');
    body.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    body.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = body.querySelector('#panel-' + tab.dataset.panel);
    if (panel) {
      panel.classList.add('active');
      body.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // ── Guide modal ───────────────────────────────────────────────────────────
  Dom.btnUserGuide.addEventListener('click', () => {
    Dom.guideModal.classList.add('visible');
  });
  Dom.btnGuideClose.addEventListener('click', () => {
    Dom.guideModal.classList.remove('visible');
  });
  Dom.guideModal.addEventListener('click', e => {
    const tab = e.target.closest('.g-tab');
    if (!tab || !tab.closest('.guide-modal-body')) return;
    const body = document.querySelector('.guide-modal-body');
    body.querySelectorAll('.g-tab').forEach(t => t.classList.remove('active'));
    body.querySelectorAll('.g-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = body.querySelector('#gpanel-' + tab.dataset.gpanel);
    if (panel) {
      panel.classList.add('active');
      body.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // ── Settings modal ────────────────────────────────────────────────────────
  Dom.btnSettings.addEventListener('click', () => {
    renderSettingsModal();
    Dom.settingsModal.classList.add('visible');
  });
  Dom.btnSettingsClose.addEventListener('click', () => {
    Dom.settingsModal.classList.remove('visible');
  });

  // ── Shared Escape key ─────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      Dom.refModal.classList.remove('visible');
      Dom.guideModal.classList.remove('visible');
      Dom.settingsModal.classList.remove('visible');
    }
  });
}
