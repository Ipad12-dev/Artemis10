/**
 * PreviewWorker - Handles transpilation, bundling, and build logic
 * Runs in a Web Worker to avoid blocking the main thread
 */

class PreviewWorker {
  constructor() {
    this.babelLoaded = false;
  }

  async handleBuildProject(job) {
    const { buildId, projectId, files, config } = job;
    const errors = [];

    try {
      const normalizedFiles = this._normalizeFiles(files);

      if (normalizedFiles.length === 0) {
        errors.push({
          type: 'no-files',
          message: 'Project has no files',
        });
        return { buildId, errors, success: false };
      }

      const css = this._extractCss(normalizedFiles);
      const { js, bundleErrors } = await this._transpileAndBundle(
        normalizedFiles,
        config
      );

      if (bundleErrors.length > 0) {
        errors.push(...bundleErrors);
      }

      return {
        buildId,
        success: errors.length === 0,
        html: '',
        css,
        js,
        errors,
        metrics: {
          fileCount: normalizedFiles.length,
          bundleSize: new Blob([js]).size,
        },
      };

    } catch (error) {
      console.error('[PreviewWorker] Build error:', error);
      return {
        buildId,
        success: false,
        errors: [
          {
            type: 'build-error',
            message: error.message,
            stack: error.stack,
          },
        ],
      };
    }
  }

  async _transpileAndBundle(files, config) {
    const errors = [];
    const modules = new Map();

    try {
      await this._loadBabel();

      for (const file of files) {
        if (!/\.(js|jsx|ts|tsx)$/.test(file.path)) continue;

        try {
          const transformed = self.Babel?.transform?.(
            file.content,
            {
              presets: ['react', 'env', 'typescript'],
              filename: file.path,
              sourceType: 'module',
              retainLines: true,
            }
          );

          if (!transformed) {
            errors.push({
              type: 'transpile-error',
              path: file.path,
              message: 'Babel transform failed',
            });
            continue;
          }

          modules.set(file.path, {
            code: transformed.code,
            original: file.content,
          });

        } catch (err) {
          errors.push({
            type: 'syntax-error',
            path: file.path,
            message: err.message,
            line: err.loc?.line,
            column: err.loc?.column,
          });
        }
      }

      const entryPoint = this._findEntryPoint(files);
      if (!entryPoint) {
        errors.push({
          type: 'entry-error',
          message: 'No App, Home, index, or LandingPage component found. Create src/App.jsx with an exported component.',
        });
        return { js: '', errors };
      }

      const js = this._bundleModules(modules, entryPoint);

      return { js, errors };

    } catch (error) {
      errors.push({
        type: 'bundle-error',
        message: error.message,
      });
      return { js: '', errors };
    }
  }

  async _loadBabel() {
    if (this.babelLoaded) return;
    
    try {
      importScripts('https://unpkg.com/@babel/standalone/babel.min.js');
      this.babelLoaded = true;
    } catch (err) {
      throw new Error('Failed to load Babel: ' + err.message);
    }
  }

  _bundleModules(modules, entryPoint) {
    const moduleCode = `
      const __modules__ = {};
      const __exports__ = {};
      
      ${Array.from(modules.entries()).map(([path, { code }]) => `
        __modules__['${this._escapePath(path)}'] = function(module, exports, require) {
          ${code}
        };
      `).join('\n')}
      
      function __require__(path) {
        if (__exports__[path]) return __exports__[path];
        const module = { exports: {} };
        if (__modules__[path]) {
          __modules__[path](module, module.exports, __require__);
        }
        __exports__[path] = module.exports;
        return module.exports;
      }
      
      try {
        const AppModule = __require__('${this._escapePath(entryPoint)}');
        const Candidate = AppModule.default || AppModule.App || AppModule.Home || AppModule.LandingPage || AppModule.Website;
        
        if (Candidate && window.React && window.ReactDOM) {
          const root = document.getElementById('root');
          if (root) {
            ReactDOM.createRoot(root).render(React.createElement(Candidate));
          }
        }
      } catch (err) {
        console.error('App render error:', err);
        const root = document.getElementById('error-boundary');
        if (root) {
          root.style.display = 'block';
          root.innerHTML = '<h3>Runtime Error</h3><p>' + err.message + '</p><pre>' + err.stack + '</pre>';
        }
      }
    `;

    return moduleCode;
  }

  _escapePath(path) {
    return path.replace(/'/g, "\\'" );
  }

  _findEntryPoint(files) {
    const candidates = [
      'src/App.jsx', 'src/App.js', 'src/App.tsx', 'src/App.ts',
      'App.jsx', 'App.js', 'App.tsx', 'App.ts',
      'src/index.jsx', 'src/index.js', 'src/Home.jsx', 'src/Home.js',
      'index.jsx', 'index.js', 'Home.jsx', 'Home.js',
    ];

    for (const candidate of candidates) {
      if (files.some((f) => f.path === candidate)) {
        return candidate;
      }
    }

    const jsFile = files.find((f) => /\.(jsx?|tsx?)$/.test(f.path));
    return jsFile?.path || null;
  }

  _extractCss(files) {
    return files
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => f.content)
      .join('\n\n');
  }

  _normalizeFiles(files = []) {
    return (files || []).map((file) => ({
      path: String(file.path || '').trim(),
      language: String(file.language || 'js').toLowerCase(),
      content: String(file.content || ''),
    })).filter((f) => f.path && f.content);
  }
}

const worker = new PreviewWorker();

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'BUILD_PROJECT') {
    const result = await worker.handleBuildProject(payload);
    self.postMessage({ ...result, type: 'BUILD_COMPLETE' });
  }
};