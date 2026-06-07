/**
 * PreviewIntegration - Hooks into existing Artemis app
 */

import PreviewManager from './PreviewManager.js';

let previewManager = null;

export function initializePreviewSystem() {
  if (previewManager) return previewManager;

  previewManager = new PreviewManager({
    maxWorkers: 4,
    maxIframes: 6,
    healthCheckInterval: 3000,
    previewTimeout: 15000,
    bundleDebounce: 800,
  });

  console.log('[PreviewIntegration] Preview system initialized');
  return previewManager;
}

export async function renderPreview(projectId, project, container) {
  if (!previewManager) {
    initializePreviewSystem();
  }

  const result = project?.result || {};
  const files = normalizeFiles(result.files || []);

  return previewManager.previewProject(projectId, files, container);
}

export function enableLivePreview(projectId, onProjectChange) {
  if (!previewManager) {
    initializePreviewSystem();
  }

  return previewManager.watchProject(projectId, onProjectChange);
}

export function getPreviewMetrics() {
  return previewManager?.getMetrics() || null;
}

export function getPreviewState(projectId) {
  return previewManager?.getPreviewState(projectId) || null;
}

export function destroyPreviewSystem() {
  if (previewManager) {
    previewManager.destroy();
    previewManager = null;
  }
}

function normalizeFiles(files = []) {
  return files.map((file) => ({
    ...file,
    path: String(file.path || '').trim(),
    language: String(file.language || 'js').toLowerCase(),
    content: String(file.content || ''),
  })).filter((file) => file.path && file.content);
}