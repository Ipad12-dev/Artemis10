/**
 * PreviewManager - Orchestrates preview lifecycle, worker pool, and sandbox management
 * Production-grade preview system for Artemis
 */

export class PreviewManager {
  constructor(options = {}) {
    this.projectId = null;
    this.workerPool = [];
    this.iframePool = new Map();
    this.previewStates = new Map();
    this.fileWatchers = new Map();
    this.healthCheckIntervals = new Map();
    
    this.config = {
      maxWorkers: options.maxWorkers || 4,
      maxIframes: options.maxIframes || 6,
      healthCheckInterval: 3000,
      previewTimeout: 15000,
      bundleDebounce: 800,
      ...options,
    };

    this.metrics = {
      totalPreviews: 0,
      avgBuildTime: 0,
      errorRate: 0,
      workerRestarts: 0,
    };

    this.initialize();
  }

  async initialize() {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      const worker = new Worker(
        new URL('./PreviewWorker.js', import.meta.url),
        { type: 'module' }
      );
      worker.workerId = i;
      worker.isBusy = false;
      worker.pendingBuilds = new Map();
      this.workerPool.push(worker);
      
      worker.onmessage = (e) => this._handleWorkerMessage(e, worker);
      worker.onerror = (err) => this._handleWorkerError(err, worker);
    }
    console.log(`[PreviewManager] Initialized with ${this.config.maxWorkers} workers`);
  }

  async previewProject(projectId, files, container) {
    const startTime = performance.now();
    
    this.projectId = projectId;
    this.previewStates.set(projectId, {
      status: 'pending',
      error: null,
      startTime,
      metrics: {},
    });

    try {
      let iframe = this.iframePool.get(projectId);
      if (!iframe) {
        iframe = this._createSandbox(projectId, container);
        this.iframePool.set(projectId, iframe);
        this._startHealthCheck(projectId);
      }

      const worker = await this._acquireWorker();
      
      const buildId = `${projectId}-${Date.now()}`;
      const job = {
        buildId,
        projectId,
        files,
        config: {
          timeout: this.config.previewTimeout,
        },
      };

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Preview build timed out (15s)')),
          this.config.previewTimeout
        )
      );

      const buildPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Build promise timed out'));
          worker.pendingBuilds.delete(buildId);
        }, this.config.previewTimeout);

        worker.pendingBuilds.set(buildId, { resolve, reject, timeoutId });
        worker.postMessage({ type: 'BUILD_PROJECT', payload: job });
      });

      const result = await Promise.race([buildPromise, timeoutPromise]);

      await this._renderToSandbox(iframe, result);

      const buildTime = performance.now() - startTime;
      this._updateMetrics(projectId, 'success', buildTime);

      return {
        success: true,
        buildTime,
        buildId,
      };

    } catch (error) {
      console.error('[PreviewManager] Preview error:', error);
      this._updateMetrics(projectId, 'error', 0);
      this.previewStates.set(projectId, {
        ...this.previewStates.get(projectId),
        status: 'error',
        error: error.message,
      });
      
      await this._renderError(projectId, error.message);
      
      return {
        success: false,
        error: error.message,
      };
    }
  }

  watchProject(projectId, onUpdate) {
    let debounceTimer;
    const trigger = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        onUpdate && onUpdate();
      }, this.config.bundleDebounce);
    };

    const controller = new AbortController();
    this.fileWatchers.set(projectId, { controller, trigger });

    return () => {
      controller.abort();
      this.fileWatchers.delete(projectId);
    };
  }

  _startHealthCheck(projectId) {
    const interval = setInterval(async () => {
      const iframe = this.iframePool.get(projectId);
      if (!iframe) {
        clearInterval(interval);
        this.healthCheckIntervals.delete(projectId);
        return;
      }

      try {
        const isAlive = await this._pingIframe(iframe);
        
        if (!isAlive) {
          console.warn(`[PreviewManager] Preview ${projectId} unresponsive, restarting...`);
          this._restartPreview(projectId);
        }
      } catch (err) {
        console.error('[PreviewManager] Health check failed:', err);
      }
    }, this.config.healthCheckInterval);

    this.healthCheckIntervals.set(projectId, interval);
  }

  async _acquireWorker() {
    let worker = this.workerPool.find((w) => !w.isBusy);
    
    if (!worker) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          worker = this.workerPool.find((w) => !w.isBusy);
          if (worker) {
            clearInterval(checkInterval);
            resolve(worker);
          }
        }, 50);
      });
    }

    worker.isBusy = true;
    return worker;
  }

  async _releaseWorker(worker) {
    worker.isBusy = false;
  }

  _createSandbox(projectId, container) {
    const iframe = document.createElement('iframe');
    iframe.id = `preview-${projectId}`;
    iframe.title = `Preview for project ${projectId}`;
    iframe.sandbox.add('allow-scripts');
    iframe.sandbox.add('allow-same-origin');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.backgroundColor = '#ffffff';
    
    if (container) {
      container.appendChild(iframe);
    }

    return iframe;
  }

  async _renderToSandbox(iframe, buildResult) {
    const { html, css, js, errors } = buildResult;
    
    if (errors && errors.length > 0) {
      return this._renderErrorsToSandbox(iframe, errors);
    }

    const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${this._buildErrorBoundaryStyle()}</style>
  ${css ? `<style>${css}</style>` : ''}
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
</head>
<body>
  <div id="root"></div>
  <div id="error-boundary" style="display:none;"></div>
  <script>
    window.__ARTEMIS__ = {
      errors: [],
      paused: false,
    };
    
    window.addEventListener('error', (e) => {
      if (window.__ARTEMIS__.paused) return;
      window.__ARTEMIS__.errors.push({
        type: 'runtime',
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack || '',
        timestamp: Date.now(),
      });
      
      const boundary = document.getElementById('error-boundary');
      if (boundary) {
        boundary.style.display = 'block';
        const p = document.createElement('p');
        p.style.cssText = 'color:#d00;margin:8px 0;font-size:13px;';
        p.textContent = '⚠ ' + e.message;
        boundary.appendChild(p);
      }
    });
    
    window.addEventListener('unhandledrejection', (e) => {
      if (window.__ARTEMIS__.paused) return;
      window.__ARTEMIS__.errors.push({
        type: 'unhandled-promise',
        message: String(e.reason),
        stack: e.reason?.stack || '',
        timestamp: Date.now(),
      });
    });
  <\/script>
  ${js}
</body>
</html>
    `;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframe.src = url;
    
    return new Promise((resolve) => {
      iframe.onload = () => {
        resolve();
      };
    });
  }

  async _renderErrorsToSandbox(iframe, errors) {
    const errorHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${this._buildErrorBoundaryStyle()}</style>
</head>
<body>
  <div id="error-container">
    <h1>⚠ Build Error</h1>
    <div id="errors"></div>
  </div>
  <script>
    const container = document.getElementById('errors');
    const errors = ${JSON.stringify(errors)};
    errors.forEach(err => {
      const div = document.createElement('div');
      div.className = 'error-item';
      div.innerHTML = '<h3>' + (err.type || 'Error') + '</h3>' +
                      '<p><strong>' + (err.message || '') + '</strong></p>' +
                      (err.source ? '<pre>' + err.source + '</pre>' : '');
      container.appendChild(div);
    });
  <\/script>
</body>
</html>
    `;

    const blob = new Blob([errorHtml], { type: 'text/html' });
    iframe.src = URL.createObjectURL(blob);
  }

  async _renderError(projectId, message) {
    const iframe = this.iframePool.get(projectId);
    if (!iframe) return;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${this._buildErrorBoundaryStyle()}</style>
</head>
<body>
  <div id="error-container">
    <h1>⚠ Preview Unavailable</h1>
    <p>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    <p style="font-size:12px;color:#666;">Please check the project files and try again.</p>
  </div>
</body>
</html>
    `;

    const blob = new Blob([html], { type: 'text/html' });
    iframe.src = URL.createObjectURL(blob);
  }

  _buildErrorBoundaryStyle() {
    return `
      html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #111; }
      #error-container {
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: 32px;
      }
      #error-container > div, #errors {
        max-width: 600px;
        width: 100%;
      }
      #error-container h1 { margin: 0 0 16px; font-size: 24px; }
      #error-container p { margin: 0 0 12px; line-height: 1.6; }
      .error-item {
        margin-bottom: 16px;
        padding: 12px;
        border-left: 3px solid #d00;
        background: #fafafa;
        border-radius: 4px;
      }
      .error-item h3 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #d00;
      }
      .error-item p {
        margin: 0 0 8px;
        font-size: 13px;
      }
      .error-item pre {
        margin: 0;
        padding: 8px;
        background: #f5f5f5;
        font-size: 11px;
        overflow-x: auto;
        border-radius: 4px;
      }
      #error-boundary {
        padding: 16px;
        background: #fff9f9;
        border: 1px solid #ffcccc;
        border-radius: 8px;
        margin-top: 16px;
      }
      #error-boundary p {
        margin: 0;
      }
    `;
  }

  async _pingIframe(iframe) {
    try {
      return await Promise.race([
        new Promise((resolve) => {
          const handler = () => {
            iframe.contentWindow.removeEventListener('message', handler);
            resolve(true);
          };
          iframe.contentWindow.addEventListener('message', handler, { once: true });
          iframe.contentWindow.postMessage({ type: 'PING' }, '*');
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('iframe ping timeout')), 1000)
        ),
      ]);
    } catch {
      return false;
    }
  }

  async _restartPreview(projectId) {
    const iframe = this.iframePool.get(projectId);
    if (iframe) {
      iframe.remove();
      this.iframePool.delete(projectId);
    }
    
    const interval = this.healthCheckIntervals.get(projectId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(projectId);
    }

    this.metrics.workerRestarts++;
  }

  _handleWorkerMessage(event, worker) {
    const { buildId, type, payload } = event.data;
    
    if (type === 'BUILD_COMPLETE') {
      const builds = worker.pendingBuilds?.get(buildId);
      if (builds) {
        clearTimeout(builds.timeoutId);
        builds.resolve(payload);
        worker.pendingBuilds.delete(buildId);
      }
      this._releaseWorker(worker);
    }
  }

  _handleWorkerError(error, worker) {
    console.error('[PreviewManager] Worker error:', error);
    
    const index = this.workerPool.indexOf(worker);
    if (index !== -1) {
      this.workerPool.splice(index, 1);
      const newWorker = new Worker(
        new URL('./PreviewWorker.js', import.meta.url),
        { type: 'module' }
      );
      newWorker.workerId = worker.workerId;
      newWorker.isBusy = false;
      newWorker.pendingBuilds = new Map();
      this.workerPool.push(newWorker);
      newWorker.onmessage = (e) => this._handleWorkerMessage(e, newWorker);
      newWorker.onerror = (err) => this._handleWorkerError(err, newWorker);
    }

    this.metrics.workerRestarts++;
  }

  _updateMetrics(projectId, status, buildTime) {
    const state = this.previewStates.get(projectId) || {};
    state.metrics = {
      buildTime,
      status,
      timestamp: Date.now(),
    };
    this.previewStates.set(projectId, state);

    this.metrics.totalPreviews++;
    this.metrics.avgBuildTime =
      (this.metrics.avgBuildTime * (this.metrics.totalPreviews - 1) + buildTime) /
      this.metrics.totalPreviews;

    if (status === 'error') {
      this.metrics.errorRate = 
        (this.metrics.errorRate * (this.metrics.totalPreviews - 1) + 1) /
        this.metrics.totalPreviews;
    }
  }

  destroy() {
    this.workerPool.forEach((w) => w.terminate());
    this.iframePool.forEach((iframe) => {
      try { iframe.remove(); } catch {}
    });
    this.healthCheckIntervals.forEach((i) => clearInterval(i));
    this.fileWatchers.forEach(({ controller }) => controller.abort());
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getPreviewState(projectId) {
    return this.previewStates.get(projectId) || null;
  }
}

export default PreviewManager;