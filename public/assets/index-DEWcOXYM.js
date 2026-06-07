const DB_NAME = "artemis-db";
const DB_VERSION = 1;
const SESSION_KEY = "artemis_session";
const root = document.getElementById("root");

document.title = "Artemis | Studio";

// ── Artemis design tokens — Phase 6 ─────────────────────────────────────────
// Brand: Goldenrod #E8A736  |  Parchment #FAEFD9
const COLORS = {
  bg:           "#FFFDF9",
  panel:        "#FFFFFF",
  panel2:       "#F7F3EC",
  accent:       "#E8A736",
  accentHover:  "#D4941F",
  accentSubtle: "#FAEFD9",
  accentText:   "#7A4F0D",
  text:         "#1A1208",
  muted:        "#6B5D4E",
  faint:        "#A0907E",
  line:         "#E8DDD0",
  line2:        "#D4C4B0",
  codeBase:     "#1C1814",
  shadow:       "0 4px 24px rgba(26,18,8,0.08),0 1px 4px rgba(26,18,8,0.04)",
  shadowMd:     "0 8px 32px rgba(26,18,8,0.12),0 2px 8px rgba(26,18,8,0.06)",
  shadowLg:     "0 20px 60px rgba(26,18,8,0.16),0 4px 16px rgba(26,18,8,0.08)",
  shadowStrong: "0 24px 72px rgba(26,18,8,0.18),0 6px 20px rgba(26,18,8,0.10)",
};

const SYSTEM_FONT = '"Inter","Segoe UI",system-ui,Arial,sans-serif';
const SERIF_FONT  = '"Iowan Old Style","Palatino Linotype",Georgia,serif';
const CODE_FONT   = '"SFMono-Regular","Fira Code",Consolas,"Liberation Mono",Menlo,monospace';
const appConfig = window.ARTEMIS_CONFIG || {};
const codesandboxConfig = appConfig.codesandbox || {};

const state = {
  booting: true,
  error: "",
  notice: "",
  authMode: "login",
  showPassword: false,
  user: null,
  search: "",
  projects: [],
  currentProjectId: null,
  currentTab: "code",
  selectedFileIndex: 0,
  authForm: { name: "", email: "", password: "" },
  newPrompt: "",
  refinePrompt: "",
  buildMode: "build",
  buildStage: "",
  buildDetails: [],
  lastPlan: null,
  fullscreenPreview: false,
  busy: false,
  copied: "",
  pendingDeleteId: null,    // P3: tracks which project awaits delete confirmation
};

const systemPrompt = `You are Artemis, a senior product engineer.
Return STRICT JSON only, with this schema:
{
  "appName": "App Name",
  "description": "One short sentence",
  "files": [{"path":"relative/path","language":"jsx|js|ts|tsx|css|json|html|md","content":"full file content"}],
  "fileTree": "ASCII tree",
  "setupInstructions": ["npm install","npm run dev"],
  "nextImprovements": ["short bullet"],
  "creatorNotes": ["what you built and why"],
  "uxRationale": ["responsive layout, interaction, and animation decisions"],
  "spaceForImprovement": ["future product ideas"],
  "previewHtml": "a complete standalone HTML document that previews the app"
}

Rules:
- No markdown fences.
- Start with { and end with }.
- Every string value must be valid JSON with escaped quotes and no unescaped newlines.
- Build modern responsive websites or web apps with excellent UI/UX.
- Include purposeful animations, hover/focus states, mobile layouts, and polished empty/loading states.
- Prefer complete multi-file frontend projects using React or vanilla JS, CSS, and HTML when useful.
- Avoid plain one-file HTML unless the user explicitly asks for a tiny page.
- Always include a main React component named App in src/App.jsx or App.jsx when generating React.
- Keep preview-friendly component code self-contained; avoid external package imports except React.
- Make previewHtml a complete, runnable, visually close standalone demo of the app.
- Explain the created web experience through creatorNotes, uxRationale, and spaceForImprovement.
- Keep files focused, working, and production-minded.`;

const planPrompt = `You are Artemis, a strategic product designer and frontend architect.
Return STRICT JSON only, with this schema:
{
  "appName": "App Name",
  "summary": "One short sentence",
  "audience": "Primary user",
  "experienceDirection": "UI/UX direction",
  "pages": ["page or screen"],
  "components": ["important component"],
  "responsiveBehavior": ["mobile/tablet/desktop behavior"],
  "animations": ["purposeful animation"],
  "dataModel": ["local data needed"],
  "buildPrompt": "A refined prompt Artemis can use to build the project"
}

Rules:
- No markdown fences.
- Start with { and end with }.
- Every string value must be valid JSON with escaped quotes and no unescaped newlines.
- Be specific enough that a builder can implement the site immediately.
- Keep it practical and polished.`;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function slugify(value = "artemis-app") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "artemis-app";
}

function sanitiseProjectName(raw) {
  // P9: Trim whitespace, collapse internal whitespace, strip control chars
  return String(raw || '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')  // control chars → space
    .replace(/\s+/g, ' ')               // collapse runs of whitespace
    .trim()
    .slice(0, 120) || 'Untitled App';   // hard max length + fallback
}

function uid() {
  // P8: Use crypto.getRandomValues for collision-resistant IDs
  const arr = new Uint8Array(9);
  crypto.getRandomValues(arr);
  const rand = Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
  return Date.now().toString(36) + '-' + rand;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function openDB() {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      return reject(new Error('IndexedDB unavailable: ' + e.message));
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains('projects')) {
        const store = db.createObjectStore('projects', { keyPath: 'id' });
        store.createIndex('ownerEmail', 'ownerEmail', { unique: false });
        store.createIndex('updatedAt',  'updatedAt',  { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error(
      'IndexedDB upgrade blocked. Close other Artemis tabs and reload.'
    ));
  });
}

// B11: DB promise with automatic recovery – if the DB fails to open,
// getDb() will attempt to reopen it on the next operation rather than
// returning a permanently rejected promise.
let _dbInstance = null;
let _dbOpenPromise = null;

async function getDb() {
  if (_dbInstance) return _dbInstance;
  if (!_dbOpenPromise) {
    _dbOpenPromise = openDB()
      .then(db => {
        _dbInstance = db;
        // If the DB connection is closed unexpectedly, reset so next call reopens
        db.onclose = () => { _dbInstance = null; _dbOpenPromise = null; };
        return db;
      })
      .catch(err => {
        _dbOpenPromise = null; // allow retry next call
        throw err;
      });
  }
  return _dbOpenPromise;
}

// Keep legacy alias so existing call sites that use dbPromise still work
// (upsertProject references it for preview cache invalidation)
Object.defineProperty(window, 'dbPromise', {
  get: function() { return getDb(); },
  configurable: true
});

// B12: requestToPromise now also handles transaction abort
function requestToPromise(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror   = () => reject(idbRequest.error || new Error('IDB request failed'));
    // Also catch transaction-level abort (e.g. storage quota exceeded)
    if (idbRequest.transaction) {
      idbRequest.transaction.onabort = () =>
        reject(new Error('IndexedDB transaction aborted — storage quota may be full.'));
    }
  });
}

async function getUser(email) {
  const db = await getDb();
  const tx = db.transaction("users", "readonly");
  return requestToPromise(tx.objectStore("users").get(email));
}

async function saveUser(user) {
  const db = await getDb();
  const tx = db.transaction("users", "readwrite");
  await requestToPromise(tx.objectStore("users").put(user));
  return user;
}

async function listProjects(ownerEmail) {
  const db = await getDb();
  const tx = db.transaction("projects", "readonly");
  const items = await requestToPromise(tx.objectStore("projects").index("ownerEmail").getAll(ownerEmail));
  // P7: Safe sort — treat missing updatedAt as epoch so they sort to the bottom
  return (items || []).sort((a, b) => {
    const ta = a.updatedAt || '1970-01-01T00:00:00.000Z';
    const tb = b.updatedAt || '1970-01-01T00:00:00.000Z';
    return tb.localeCompare(ta);
  });
}

async function upsertProject(project) {
  const db = await getDb();
  const tx = db.transaction("projects", "readwrite");
  await requestToPromise(tx.objectStore("projects").put(project));
  // Invalidate preview cache for this project so next preview open re-renders
  if (typeof _previewMounted !== 'undefined' && _previewMounted.projectId === project.id) {
    _previewMounted.projectId = null;
  }
  if (typeof _previewMountedFs !== 'undefined' && _previewMountedFs.projectId === project.id) {
    _previewMountedFs.projectId = null;
  }
  return project;
}

async function deleteProject(id) {
  const db = await getDb();
  const tx = db.transaction("projects", "readwrite");
  await requestToPromise(tx.objectStore("projects").delete(id));
  return true;
}

function sessionUserEmail() {
  // B13: use localStorage so the session survives tab close/reopen
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    // Fallback to sessionStorage if localStorage is blocked (e.g. Safari ITP)
    try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
  }
}

function setSessionUserEmail(email) {
  try {
    if (email) localStorage.setItem(SESSION_KEY, email);
    else        localStorage.removeItem(SESSION_KEY);
  } catch {
    try {
      if (email) sessionStorage.setItem(SESSION_KEY, email);
      else        sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function notify(message) {
  setState({ notice: message });
  window.clearTimeout(notify._timer);
  notify._timer = window.setTimeout(() => setState({ notice: "" }), 2200);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function showBuildStage(stage, detail) {
  // B14: removed artificial 260ms delay — only update the UI, don't fake wait
  state.buildStage = stage;
  state.buildDetails = [...state.buildDetails, detail].slice(-6);
  render();
  // Yield to the browser for one paint cycle so the stage text is visible
  await new Promise(r => requestAnimationFrame(r));
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.currentProjectId) || null;
}

function normalizeFiles(files = []) {
  return files.map((file) => ({
    ...file,
    path: String(file.path || "").trim(),
    language: String(file.language || "js").toLowerCase(),
    content: String(file.content || ""),
  })).filter((file) => file.path && file.content);
}

function parseGitHubRepo(value = "") {
  const input = String(value).trim().replace(/\.git$/, "");
  if (!input) return null;
  const match = input.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+)/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
  };
}

function buildCodeSandboxRepoUrl() {
  const repo = parseGitHubRepo(codesandboxConfig.githubRepo);
  if (!repo) return "";
  const baseUrl = String(codesandboxConfig.importBaseUrl || "https://codesandbox.io/p/github").replace(/\/$/, "");
  const branch = encodeURIComponent(codesandboxConfig.branch || "main");
  const filePath = codesandboxConfig.file ? `?file=${encodeURIComponent(codesandboxConfig.file)}` : "";
  return `${baseUrl}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tree/${branch}${filePath}`;
}

function getCodeSandboxFiles(project) {
  const result = project?.result || {};
  const files = normalizeFiles(result.files || []);
  const hasPackage = files.some((file) => file.path === "package.json");
  const hasIndex = files.some((file) => /(^|\/)index\.html$/i.test(file.path));
  const sandboxFiles = files.reduce((acc, file) => {
    acc[file.path] = { content: file.content };
    return acc;
  }, {});

  if (!hasPackage) {
    sandboxFiles["package.json"] = {
      content: JSON.stringify({
        scripts: { start: "vite --host 0.0.0.0" },
        dependencies: {
          "@vitejs/plugin-react": "latest",
          "vite": "latest",
          "react": "latest",
          "react-dom": "latest",
        },
        devDependencies: {},
      }, null, 2),
    };
  }

  if (!hasIndex) {
    sandboxFiles["index.html"] = {
      content: '<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Artemis Preview</title></head><body><div id="root"></div><script type="module" src="/src/App.jsx"></script></body></html>',
    };
  }

  return sandboxFiles;
}

function openCodeSandbox(project) {
  const repoUrl = buildCodeSandboxRepoUrl();
  if (repoUrl) {
    window.open(repoUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://codesandbox.io/api/v1/sandboxes/define?json=1";
  form.target = "_blank";
  form.style.display = "none";

  const parameters = document.createElement("input");
  parameters.type = "hidden";
  parameters.name = "parameters";
  parameters.value = JSON.stringify({
    files: getCodeSandboxFiles(project),
  });

  const query = document.createElement("input");
  query.type = "hidden";
  query.name = "query";
  query.value = JSON.stringify({
    name: slugify(project?.name || "artemis-preview"),
    module: "/src/App.jsx",
  });

  form.append(parameters, query);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

// ─── PREVIEW SYSTEM v2 (production-quality) ──────────────────────────────
//
// Root-cause fixes:
//   1. Robust import/export stripping handles all AI-generated patterns
//   2. Entry file ordering (helpers first, App/Home last)
//   3. Loading state, visible build errors, runtime error overlay
//   4. postMessage error reporting to parent frame
//   5. fallback chain: JS runtime → previewHtml → static HTML → blank

function stripImportsAndExports(source) {
  let s = String(source || '');
  // Multi-line and single-line static imports: import ... from '...';
  s = s.replace(/^[ \t]*import[\s\S]*?from\s+['"][^'"]*['"];?[ \t]*$/gm, '');
  // Side-effect imports: import 'x';
  s = s.replace(/^[ \t]*import\s+['"][^'"]*['"];?[ \t]*$/gm, '');
  // Re-export with from: export { X } from 'y'; export * from 'y';
  s = s.replace(/^[ \t]*export\s*\{[^}]*\}\s*from\s+['"][^'"]*['"];?[ \t]*$/gm, '');
  s = s.replace(/^[ \t]*export\s*\*\s*(?:as\s+\w+\s*)?from\s+['"][^'"]*['"];?[ \t]*$/gm, '');
  // Named re-export (no from): export { X, Y };
  s = s.replace(/^[ \t]*export\s*\{[^}]*\};?[ \t]*$/gm, '');
  // Strip 'export default' prefix (keep body)
  s = s.replace(/^[ \t]*export\s+default\s+/gm, '');
  // Strip 'export' keyword from declarations
  s = s.replace(/^[ \t]*export\s+(?=(?:const|let|var|function|class|async)\s)/gm, '');
  return s;
}

function makePreviewRuntime(files, project) {
  var cssContent = files
    .filter(function(f) { return f.path.endsWith('.css'); })
    .map(function(f) { return f.content; })
    .join('\n\n');

  var jsFiles = files.filter(function(f) { return /\.(js|jsx|ts|tsx)$/.test(f.path); });
  var entryPattern = /(?:^|\/)(App|Home|LandingPage|Website|main|index)\.(jsx?|tsx?)$/i;
  var entryFiles = jsFiles.filter(function(f) { return entryPattern.test(f.path); });
  var supportFiles = jsFiles.filter(function(f) { return !entryPattern.test(f.path); });
  var ordered = supportFiles.concat(entryFiles);

  var scripts = ordered.map(function(f) {
    return '/* --- ' + f.path + ' --- */\n' + stripImportsAndExports(f.content);
  }).join('\n\n');

  var pName = (project && project.name) ? project.name.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Preview';

  var html = [];
  html.push('<!doctype html>');
  html.push('<html>');
  html.push('<head>');
  html.push('  <meta charset="utf-8" />');
  html.push('  <meta name="viewport" content="width=device-width, initial-scale=1" />');
  html.push('  <script>window.__cdnErrors=[];window.__cdnLoaded=0;<\/script>');
  html.push('  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js" onload="window.__cdnLoaded++" onerror="window.__cdnErrors.push(&apos;React CDN failed&apos;)"><\/script>');
  html.push('  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" onload="window.__cdnLoaded++" onerror="window.__cdnErrors.push(&apos;ReactDOM CDN failed&apos;)"><\/script>');
  html.push('  <script src="https://unpkg.com/@babel/standalone/babel.min.js" onload="window.__cdnLoaded++" onerror="window.__cdnErrors.push(&apos;Babel CDN failed&apos;)"><\/script>');
  html.push('  <style>');
  html.push('    :root { color-scheme: light; }');
  html.push('    html, body, #root { min-height: 100%; margin: 0; }');
  html.push('    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: #fff; color: #111; }');
  html.push('    #preview-loading { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: #fff; flex-direction: column; gap: 16px; }');
  html.push('    #preview-loading .spinner { width: 28px; height: 28px; border: 2px solid #e0e0e0; border-top-color: #111; border-radius: 50%; animation: spin 0.7s linear infinite; }');
  html.push('    #preview-loading p { margin: 0; font-size: 13px; color: #888; }');
  html.push('    @keyframes spin { to { transform: rotate(360deg); } }');
  html.push('    #preview-error { display: none; position: fixed; inset: 0; z-index: 200; background: #fff; overflow: auto; padding: 32px; }');
  html.push('    #preview-error .err-hdr { font-size: 15px; font-weight: 600; color: #c00; margin: 0 0 16px; }');
  html.push('    #preview-error pre { margin: 0; padding: 16px; background: #fafafa; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: #111; font-family: "SFMono-Regular", Consolas, monospace; }');
  html.push('    #preview-error .err-hint { margin: 12px 0 0; font-size: 12px; color: #666; }');
  html.push('    #preview-runtime-bar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 150; background: #fff3f3; border-top: 2px solid #e00; padding: 10px 16px; font-size: 12px; color: #900; font-family: "SFMono-Regular", Consolas, monospace; max-height: 180px; overflow: auto; display: none; white-space: pre-wrap; word-break: break-all; }');
  if (cssContent) { html.push(cssContent); }
  html.push('  </style>');
  html.push('</head>');
  html.push('<body>');
  html.push('  <div id="preview-loading"><div class="spinner"></div><p>Compiling\u2026</p></div>');
  html.push('  <div id="preview-error"><div class="err-hdr">\u26a0 Build / Compile Error</div><pre id="preview-error-text"></pre><p class="err-hint">Fix the error in the Code tab or refine with a new prompt.</p></div>');
  html.push('  <div id="preview-runtime-bar"></div>');
  html.push('  <div id="root"></div>');
  html.push('  <' + 'script>');
  html.push('    // ── Capture real errors before "Script error." sanitisation ──');
  html.push('    var _runtimeBar = null;');
  html.push('    var _errorEl = null;');
  html.push('    var _errorTextEl = null;');
  html.push('    var _lastRealError = null;');
  html.push('    function _showError(msg, stack) {');
  html.push('      _runtimeBar = _runtimeBar || document.getElementById("preview-runtime-bar");');
  html.push('      if (_runtimeBar) {');
  html.push('        _runtimeBar.style.display = "block";');
  html.push('        _runtimeBar.textContent = "\u26a0 " + msg + (stack ? "\n" + stack : "");');
  html.push('      }');
  html.push('      try {');
  html.push('        window.parent.postMessage({ type: "ARTEMIS_PREVIEW_ERROR", message: msg, stack: stack || "" }, "*");');
  html.push('      } catch(x) {}');
  html.push('    }');
  html.push('    var _origConsoleError = console.error.bind(console);');
  html.push('    console.error = function() {');
  html.push('      _origConsoleError.apply(console, arguments);');
  html.push('      var args = Array.prototype.slice.call(arguments);');
  html.push('      var firstArg = args[0];');
  html.push('      if (firstArg instanceof Error) {');
  html.push('        _lastRealError = { message: firstArg.message, stack: firstArg.stack };');
  html.push('      } else if (args[1] instanceof Error) {');
  html.push('        _lastRealError = { message: args[1].message, stack: args[1].stack };');
  html.push('      } else if (typeof firstArg === "string" && args.length > 1) {');
  html.push('        var combined = args.map(function(a) { return a instanceof Error ? a.message : String(a); }).join(" ");');
  html.push('        if (combined.length > 20) _lastRealError = { message: combined, stack: args[1] && args[1].stack || "" };');
  html.push('      }');
  html.push('    };');
  html.push('    window.addEventListener("error", function(e) {');
  html.push('      var msg = e.message;');
  html.push('      var stack = e.error && e.error.stack ? e.error.stack : "";');
  html.push('      if (!msg || msg === "Script error." || msg === "Script error") {');
  html.push('        if (_lastRealError) {');
  html.push('          msg = _lastRealError.message || msg;');
  html.push('          stack = _lastRealError.stack || stack;');
  html.push('        } else {');
  html.push('          msg = "Script error (cross-origin). Check the Code tab for syntax errors.";');
  html.push('        }');
  html.push('      }');
  html.push('      _showError(msg, stack);');
  html.push('    });');
  html.push('    window.addEventListener("unhandledrejection", function(e) {');
  html.push('      var m = e.reason instanceof Error ? e.reason.message : String(e.reason || "Unhandled promise rejection");');
  html.push('      var s = e.reason instanceof Error ? e.reason.stack || "" : "";');
  html.push('      _showError(m, s);');
  html.push('    });');
  html.push('    setTimeout(function() {');
  html.push('      var loading = document.getElementById("preview-loading");');
  html.push('      if (loading && loading.style.display !== "none") {');
  html.push('        loading.style.display = "none";');
  html.push('        var cdnErrs = window.__cdnErrors && window.__cdnErrors.length ? window.__cdnErrors.join(", ") : "";');
  html.push('        var msg = cdnErrs ? "CDN load failed: " + cdnErrs : "Preview timed out. The CDN scripts (React/Babel) may be blocked by your network or browser extension.";');
  html.push('        _showError(msg, "");');
  html.push('      }');
  html.push('    }, 12000);');
  html.push('  </' + 'script>');
  html.push('  <script type="text/babel" data-presets="env,react,typescript">');
  html.push('    var _loading = document.getElementById("preview-loading");');
  html.push('    if (_loading) _loading.style.display = "none";');
  html.push('    try {');
  html.push('      var useState = React.useState; var useEffect = React.useEffect; var useMemo = React.useMemo;');
  html.push('      var useCallback = React.useCallback; var useRef = React.useRef; var useContext = React.useContext;');
  html.push('      var useReducer = React.useReducer; var useLayoutEffect = React.useLayoutEffect;');
  html.push('      var createContext = React.createContext; var forwardRef = React.forwardRef;');
  html.push('      var memo = React.memo; var Fragment = React.Fragment;');
  html.push('      // ── Error boundary catches React render errors with real stack ──');
  html.push('      class __ErrorBoundary extends React.Component {');
  html.push('        constructor(p) { super(p); this.state = { err: null }; }');
  html.push('        static getDerivedStateFromError(err) { return { err: err }; }');
  html.push('        componentDidCatch(err, info) {');
  html.push('          var msg = err && err.message ? err.message : String(err);');
  html.push('          var stack = (err && err.stack ? err.stack : "") + (info && info.componentStack ? "\n\nComponent stack:" + info.componentStack : "");');
  html.push('          if (typeof _showError === "function") _showError(msg, stack);');
  html.push('          try { window.parent.postMessage({ type: "ARTEMIS_PREVIEW_ERROR", message: msg, stack: stack }, "*"); } catch(x) {}');
  html.push('        }');
  html.push('        render() {');
  html.push('          if (this.state.err) {');
  html.push('            var msg = this.state.err.message || String(this.state.err);');
  html.push('            return React.createElement("div", { style: { padding: "24px", fontFamily: "monospace", color: "#c00", background: "#fff9f9", borderRadius: "8px", margin: "16px", border: "1px solid #fcc" } },');
  html.push('              React.createElement("strong", null, "\u26a0 Render error: "),');
  html.push('              React.createElement("span", null, msg)');
  html.push('            );');
  html.push('          }');
  html.push('          return this.props.children;');
  html.push('        }');
  html.push('      }');
  html.push('      ' + scripts.split('\n').join('\n      '));
  html.push('      var _root = document.getElementById("root");');
  html.push('      var Candidate = (typeof App !== "undefined" && App) || (typeof Home !== "undefined" && Home) || (typeof LandingPage !== "undefined" && LandingPage) || (typeof Website !== "undefined" && Website) || null;');
  html.push('      if (Candidate && _root) {');
  html.push('        ReactDOM.createRoot(_root).render(');
  html.push('          React.createElement(__ErrorBoundary, null, React.createElement(Candidate))');
  html.push('        );');
  html.push('        try { window.parent.postMessage({ type: "ARTEMIS_PREVIEW_READY" }, "*"); } catch(x) {}');
  html.push('      } else if (_root) {');
  html.push('        var _nm = document.createElement("main");' +
              '         _nm.style="min-height:100vh;display:grid;place-items:center;padding:32px";' +
              '         _nm.innerHTML = "<section style=\\"max-width:600px;border:1px solid #e0e0e0;padding:24px;border-radius:12px\\"><h2 style=\\"margin:0 0 10px;font-family:Georgia,serif\\">"+pName+"</h2><p style=\\"color:#666;line-height:1.7\\">No mountable component found. Ensure a file exports a default component named App, Home, LandingPage, or Website.</p></section>";' +
              '         _root.appendChild(_nm);');
  html.push('      }');
  html.push('    } catch(err) {');
  html.push('      var _l2 = document.getElementById("preview-loading");');
  html.push('      if (_l2) _l2.style.display = "none";');
  html.push('      var _e2 = document.getElementById("preview-error");');
  html.push('      var _et2 = document.getElementById("preview-error-text");');
  html.push('      if (_e2 && _et2) { _e2.style.display = "block"; _et2.textContent = err.message + (err.stack ? "\n\n" + err.stack : ""); }');
  html.push('      try { window.parent.postMessage({ type: "ARTEMIS_PREVIEW_ERROR", message: err.message, stack: err.stack || "" }, "*"); } catch(x) {}');
  html.push('    }');
  html.push('  </' + 'script>');
  html.push('</body>');
  html.push('</html>');
  return html.join('\n');
}

function getPreviewSrcDoc(project) {
  var result = project && project.result ? project.result : {};
  var files = Array.isArray(result.files) ? normalizeFiles(result.files) : [];
  var runnableFiles = files.filter(function(f) { return /.(js|jsx|ts|tsx)$/.test(f.path); });

  if (runnableFiles.length) {
    return makePreviewRuntime(files, project);
  }

  if (typeof result.previewHtml === 'string' && result.previewHtml.trim()) {
    var ph = result.previewHtml.trim();
    var errorScript = '<script>window.addEventListener("error",function(e){try{window.parent.postMessage({type:"ARTEMIS_PREVIEW_ERROR",message:e.message},"*");}catch(x){}});<\/script>';
    if (/^<!doctype|^<html/i.test(ph)) {
      return ph.replace('</body>', errorScript + '</body>');
    }
    return ph;
  }

  var htmlFile = files.find(function(f) { return /.html?$/.test(f.path); });
  if (htmlFile && htmlFile.content) {
    var css = files.filter(function(f) { return f.path.endsWith('.css'); }).map(function(f) { return f.content; }).join('\n\n');
    return css ? htmlFile.content.replace('</head>', '<style>' + css + '</style></head>') : htmlFile.content;
  }

  return '<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>' +
    '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;background:#fff;color:#111;display:grid;place-items:center;min-height:100vh;padding:32px">' +
    '<section style="max-width:680px;border:1px solid #e0e0e0;padding:28px;border-radius:14px;text-align:center">' +
    '<h2 style="font-family:Georgia,serif;margin:0 0 12px">No preview available</h2>' +
    '<p style="color:#666;line-height:1.8;margin:0">This project has no renderable files yet.<br>' +
    'Try refining it: <em>"make this a React App component"</em></p>' +
    '</section></body></html>';
}

function renderLogo() {
  return `
    <div class="logo-mark" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="brand-copy">
      <div class="brand-name">Artemis</div>
      <div class="brand-role">Studio</div>
    </div>
  `;
}

function chromeShell(content) {
  return `<div class="app-shell">${content}</div>`;
}

function authView() {
  const isSignup = state.authMode === "signup";
  return chromeShell(`
    <section class="auth-layout">
      <div class="hero-copy">
        <div class="hero-badge">MONOCHROME BUILD STUDIO</div>
        <h1>Build and preview apps with a calmer, more serious interface.</h1>
        <p>Artemis stores accounts and projects in IndexedDB, generates code from your prompt, and shows the output in a live sandboxed preview.</p>
      </div>
      <div class="auth-card">
        <div class="auth-switch">
          <button class="${state.authMode === "login" ? "active" : ""}" data-action="auth-tab" data-mode="login">Sign In</button>
          <button class="${state.authMode === "signup" ? "active" : ""}" data-action="auth-tab" data-mode="signup">Create Account</button>
        </div>
        <div class="form-grid">
          ${isSignup ? `
            <label>Full name
              <input data-field="name" value="${escapeAttr(state.authForm.name)}" placeholder="Your name" />
            </label>` : ""}
          <label>Email address
            <input data-field="email" type="email" value="${escapeAttr(state.authForm.email)}" placeholder="name@company.com" />
          </label>
          <label>Password
            <div class="password-row">
              <input data-field="password" type="${state.showPassword ? "text" : "password"}" value="${escapeAttr(state.authForm.password)}" placeholder="••••••••" />
              <button type="button" data-action="toggle-password">${state.showPassword ? "Hide" : "Show"}</button>
            </div>
          </label>
        </div>
        ${state.error ? `<div class="error-box">⚠ ${escapeHtml(state.error)}</div>` : ""}
        <button class="primary-btn full" data-action="submit-auth">${isSignup ? "Create Account" : "Sign In"}</button>
        <button class="text-link" data-action="switch-auth-mode">
          ${isSignup ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
        <div class="auth-note">Demo auth backed by browser storage. Projects persist in IndexedDB on this device.</div>
      </div>
    </section>
  `);
}

function dashboardView() {
  const filtered = state.projects.filter((project) => {
    if (!state.search.trim()) return true;
    const query = state.search.toLowerCase();
    return [project.name, project.description, project.prompt].some((field) => String(field || "").toLowerCase().includes(query));
  });

  return chromeShell(`
    <header class="topbar">
      ${renderLogo()}
      <div class="topbar-search">
        <input data-field="search" value="${escapeAttr(state.search)}" placeholder="Search projects" />
      </div>
      <div class="user-chip">
        <div class="avatar">${escapeHtml((state.user?.name || state.user?.email || "?").slice(0, 1).toUpperCase())}</div>
        <div>
          <div class="user-name">${escapeHtml(state.user?.name || state.user?.email || "")}</div>
          <div class="user-email">${escapeHtml(state.user?.email || "")}</div>
        </div>
      </div>
      <button class="primary-btn" data-action="new-project">New App</button>
      <button class="ghost-btn" data-action="sign-out">Sign out</button>
    </header>
    <main class="page">
      <section class="page-head">
        <h1>Your Projects</h1>
        <p>${filtered.length} of ${state.projects.length} saved locally</p>
      </section>
      <section class="project-grid">
        <button class="create-card" data-action="new-project">
          <div class="create-plus">+</div>
          <strong>Create a new app</strong>
          <span>Write a prompt and generate a fresh project</span>
        </button>
        ${filtered.map(projectCard).join("")}
      </section>
    </main>
  `);
}

function projectCard(project) {
  const count = Array.isArray(project.result?.files) ? project.result.files.length : 0;
  return `
    <article class="project-card" data-action="open-project" data-id="${escapeAttr(project.id)}">
      <div class="project-card-top">
        <div class="mini-mark"></div>
        <button class="mini-link danger" data-action="delete-project" data-id="${escapeAttr(project.id)}">Delete</button>
      </div>
      <h3>${escapeHtml(project.name)}</h3>
      <p>${escapeHtml(project.description)}</p>
      <div class="project-meta">
        <span>${count} files</span>
        <span>${formatDate(project.updatedAt)}</span>
      </div>
    </article>
  `;
}

function newProjectView() {
  const plan = state.lastPlan;
  return chromeShell(`
    <header class="topbar">
      ${renderLogo()}
      <button class="ghost-btn" data-action="back-dashboard">Dashboard</button>
      <div class="topbar-title">
        <div class="title-main">Artemis Builder</div>
        <div class="title-sub">Plan the product first, or build a complete responsive project immediately</div>
      </div>
    </header>
    <main class="builder-page">
      <section class="builder-command">
        <div class="mode-switch" role="tablist" aria-label="Build mode">
          <button class="${state.buildMode === "plan" ? "active" : ""}" data-action="set-build-mode" data-mode="plan">Plan first</button>
          <button class="${state.buildMode === "build" ? "active" : ""}" data-action="set-build-mode" data-mode="build">Build now</button>
        </div>
        <h1>${state.buildMode === "plan" ? "Shape the idea before code." : "Build the website now."}</h1>
        <p>${state.buildMode === "plan" ? "Artemis will map the audience, screens, UI direction, animation ideas, and a stronger build prompt." : "Artemis will generate a responsive, animated project with files, preview, setup notes, and product guidance."}</p>
        <textarea data-field="newPrompt" rows="8" placeholder='Example: "A premium booking website for a modern photography studio with packages, portfolio, and contact flow."'>${escapeHtml(state.newPrompt)}</textarea>
        <div class="row-between">
          <div class="hint">Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to ${state.buildMode === "plan" ? "plan" : "build"}</div>
          <div class="button-row">
            ${plan ? `<button class="ghost-btn" data-action="build-from-plan" ${state.busy ? "disabled" : ""}>Build from plan</button>` : ""}
            <button class="primary-btn" data-action="${state.buildMode === "plan" ? "plan-project" : "generate-project"}" ${state.busy ? "disabled" : ""}>${state.busy ? "Working..." : state.buildMode === "plan" ? "Plan Website" : "Build Website"}</button>
          </div>
        </div>
        ${state.busy ? `
          <div class="build-status">
            <div class="pulse-dot"></div>
            <div>
              <strong>${escapeHtml(state.buildStage || "Preparing Artemis")}</strong>
              <span>${escapeHtml(state.buildDetails.at(-1) || "Reading the brief and choosing a direction.")}</span>
            </div>
          </div>
          <div class="build-log">
            ${state.buildDetails.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
          </div>
        ` : ""}
        <div class="examples">
          ${[
            "A responsive SaaS landing page with pricing, dashboard preview, and testimonials",
            "A clean restaurant website with menu filters, reservations, and subtle motion",
            "A finance dashboard with charts, tables, export states, and mobile cards",
            "A portfolio site with case studies, project modals, and contact form",
          ].map((example) => `<button class="example-chip" data-action="fill-example" data-value="${escapeAttr(example)}">${escapeHtml(example)}</button>`).join("")}
        </div>
        ${plan ? `
          <section class="plan-card">
            <div class="eyebrow">ARTEMIS PLAN</div>
            <h2>${escapeHtml(plan.appName || "Website Plan")}</h2>
            <p>${escapeHtml(plan.summary || "")}</p>
            <div class="plan-grid">
              <div><strong>Audience</strong><span>${escapeHtml(plan.audience || "General users")}</span></div>
              <div><strong>Direction</strong><span>${escapeHtml(plan.experienceDirection || "Clean responsive interface")}</span></div>
            </div>
            <div class="plan-columns">
              ${[
                ["Pages", plan.pages],
                ["Components", plan.components],
                ["Responsive", plan.responsiveBehavior],
                ["Animations", plan.animations],
              ].map(([label, items]) => `
                <div>
                  <strong>${escapeHtml(label)}</strong>
                  ${(items || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                </div>
              `).join("")}
            </div>
          </section>
        ` : ""}
        ${state.error ? `<div class="error-box">⚠ ${escapeHtml(state.error)}</div>` : ""}
      </section>
    </main>
  `);
}

function fileTag(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return ({ jsx: "JSX", js: "JS", ts: "TS", tsx: "TSX", css: "CSS", json: "JSON", html: "HTML", md: "MD", svg: "SVG" }[ext] || ext.slice(0, 3).toUpperCase() || "?");
}

function projectView() {
  const project = selectedProject();
  if (!project) return dashboardView();
  const result = project.result || {};
  const files = normalizeFiles(result.files || []);
  const file = files[state.selectedFileIndex] || files[0] || null;
  const previewHtml = getPreviewSrcDoc(project);
  const hasCodeSandboxRepo = Boolean(buildCodeSandboxRepoUrl());

  return chromeShell(`
    <header class="topbar">
      ${renderLogo()}
      <button class="ghost-btn" data-action="back-dashboard">Projects</button>
      <div class="topbar-title">
        <div class="title-main">${escapeHtml(project.name)}</div>
        <div class="title-sub">${escapeHtml(project.description)}</div>
      </div>
      <button class="text-pill ${state.currentTab === "code" ? "active" : ""}" data-action="switch-tab" data-tab="code">Code</button>
      <button class="text-pill ${state.currentTab === "preview" ? "active" : ""}" data-action="switch-tab" data-tab="preview">Preview</button>
      <button class="text-pill ${state.currentTab === "setup" ? "active" : ""}" data-action="switch-tab" data-tab="setup">Setup</button>
      ${state.notice ? `<div class="save-pill">✓ Saved</div>` : ""}
    </header>
    <main class="workspace">
      <aside class="sidebar ${state.currentTab === "code" ? "" : "hidden"}">
        <div class="sidebar-head">FILES · ${files.length}</div>
        <div class="file-list">
          ${files.map((item, index) => `
            <button class="file-row ${index === state.selectedFileIndex ? "active" : ""}" data-action="select-file" data-index="${index}">
              <span class="file-tag">${escapeHtml(fileTag(item.path))}</span>
              <span class="file-name">${escapeHtml(item.path.split("/").pop() || item.path)}</span>
            </button>
          `).join("")}
        </div>
      </aside>

      <section class="main-panel">
        ${state.currentTab === "code" ? `
          <div class="panel-head">
            <div class="panel-file">${file ? `${escapeHtml(file.path)}` : "No file selected"}</div>
            ${file ? `<button class="mini-link" data-action="copy-code">Copy</button>` : ""}
          </div>
          <pre class="code-block"><code>${escapeHtml(file?.content || "No code available.")}</code></pre>
        ` : ""}

        ${state.currentTab === "preview" ? `
          <div class="panel-head">
            <div class="panel-file">Live Preview</div>
            <div class="panel-badges">
              <span class="badge">Sandboxed iframe</span>
              <span class="badge light">${result.previewHtml ? "Preview HTML" : "Fallback render"}</span>
              <button class="mini-link" data-action="open-codesandbox">Open CodeSandbox</button>
              <button class="mini-link" data-action="open-fullscreen-preview">Fullscreen</button>
            </div>
          </div>
          <div class="preview-shell">
            <div class="browser-bar">
              <span class="traffic red"></span>
              <span class="traffic yellow"></span>
              <span class="traffic green"></span>
              <div class="address-pill">${escapeHtml((project.name || "preview").toLowerCase().replace(/\s+/g, "-"))}.preview</div>
              <span id="preview-status-badge" class="preview-badge"></span>
            </div>
            <div id="preview-mount" style="flex:1;position:relative;background:#fff;overflow:hidden;min-height:0;"></div>
          </div>
          <div class="sandbox-note">
            ${hasCodeSandboxRepo
              ? "CodeSandbox opens the configured GitHub repository branch, so committed changes can flow back through GitHub."
              : "Set window.ARTEMIS_CONFIG.codesandbox.githubRepo in /config.js to open the shared repository; until then, this exports a one-off sandbox from the generated files."}
          </div>
        ` : ""}

        ${state.currentTab === "setup" ? `
          <div class="setup-grid">
            <section class="setup-block">
              <h2>Artemis Notes</h2>
              <div class="setup-list">
                ${(result.creatorNotes || [result.description || project.description]).map((item) => `
                  <div class="setup-item">
                    <div class="setup-step light">i</div>
                    <div>${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            </section>
            <section class="setup-block">
              <h2>UX Decisions</h2>
              <div class="setup-list">
                ${(result.uxRationale || ["Responsive structure, polished spacing, and preview-ready interface."]).map((item) => `
                  <div class="setup-item">
                    <div class="setup-step light">ux</div>
                    <div>${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            </section>
            <section class="setup-block">
              <h2>Setup Instructions</h2>
              <div class="setup-list">
                ${(result.setupInstructions || []).map((line, index) => `
                  <div class="setup-item">
                    <div class="setup-step">${index + 1}</div>
                    <code>${escapeHtml(line)}</code>
                  </div>
                `).join("")}
              </div>
            </section>
            <section class="setup-block">
              <h2>File Tree</h2>
              <pre class="tree-box">${escapeHtml(result.fileTree || "(none)")}</pre>
            </section>
            <section class="setup-block">
              <h2>Suggested Improvements</h2>
              <div class="setup-list">
                ${([...(result.nextImprovements || []), ...(result.spaceForImprovement || [])]).map((item) => `
                  <div class="setup-item">
                    <div class="setup-step light">+</div>
                    <div>${escapeHtml(item)}</div>
                  </div>
                `).join("")}
              </div>
            </section>
          </div>
        ` : ""}
      </section>
    </main>

    <footer class="refine-bar">
      ${state.error ? `<div class="error-box compact">⚠ ${escapeHtml(state.error)}</div>` : ""}
      <div class="refine-row">
        <input data-field="refinePrompt" value="${escapeAttr(state.refinePrompt)}" placeholder='Refine "${escapeAttr(project.name)}" ... e.g. "make the layout more compact"' />
        <button class="primary-btn" data-action="refine-project" ${state.busy ? "disabled" : ""}>${state.busy ? "Updating..." : "Update App"}</button>
      </div>
    </footer>
  `);
}

function fullscreenPreviewView() {
  const project = selectedProject();
  if (!project || !state.fullscreenPreview) return "";
  const previewHtml = getPreviewSrcDoc(project);
  return `
    <section class="preview-overlay" role="dialog" aria-modal="true">
      <div class="preview-overlay-head">
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <span>${escapeHtml(project.description || "Live generated preview")}</span>
        </div>
        <button class="primary-btn" data-action="close-fullscreen-preview">Close Preview</button>
      </div>
      <div id="preview-mount-fullscreen" style="flex:1;background:#fff;overflow:auto;min-height:0;"></div>
    </section>
  `;
}


function deletionConfirmBanner() {
  const project = state.projects.find(p => p.id === state.pendingDeleteId);
  const name = project ? escapeHtml(project.name) : 'this project';
  return `<div class="delete-confirm-overlay" role="alertdialog" aria-modal="true" aria-label="Confirm deletion">
    <div class="delete-confirm-box">
      <p>Delete <strong>${name}</strong>? This cannot be undone.</p>
      <div class="delete-confirm-btns">
        <button class="primary-btn danger" data-action="confirm-delete">Delete</button>
        <button class="ghost-btn" data-action="cancel-delete">Cancel</button>
      </div>
    </div>
  </div>`;
}

// ─── PERSISTENT PREVIEW IFRAME ────────────────────────────────────────────
// The iframe lives OUTSIDE the innerHTML render cycle so it is never destroyed
// by a setState() call. We create it once and only update srcdoc when the
// project ID changes or the user switches to the preview tab.
//
// Architecture:
//   - _previewIframe: the single persistent <iframe> element
//   - _previewMounted: { projectId, tab } tracks last rendered state
//   - syncPreviewIframe(): called after every render(), mounts iframe if needed
//   - handlePreviewMessage(): listens for postMessage from iframe

var _previewIframe = null;
var _previewIframeFs = null;  // fullscreen variant
var _previewMounted = { projectId: null, tab: null };
var _previewMountedFs = { projectId: null };
var _previewLastError = null; // FIX 5: stores last real error for display

function _createPreviewIframe(id, fullscreen) {
  var el = document.createElement('iframe');
  el.id = id;
  el.title = 'Live preview';
  el.sandbox.add('allow-scripts');
  // Note: allow-same-origin is intentionally NOT added (security)
  el.className = 'preview-iframe-persistent';
  if (fullscreen) {
    el.style.cssText = 'width:100%;height:100%;border:none;background:#fff;display:block;';
  }
  return el;
}

function _setBadge(status, text) {
  var badge = document.getElementById('preview-status-badge');
  if (!badge) return;
  badge.textContent = text || '';
  badge.className = 'preview-badge' + (status ? ' ' + status : '');
}

window.addEventListener('message', function(evt) {
  if (!evt.data || typeof evt.data !== 'object') return;
  if (evt.data.type === 'ARTEMIS_PREVIEW_READY') {
    _setBadge('ready', '● Live');
    // Clear any previous error state on successful load
    _previewLastError = null;
  } else if (evt.data.type === 'ARTEMIS_PREVIEW_ERROR') {
    var msg   = evt.data.message || 'Unknown error';
    var stack = evt.data.stack   || '';
    // FIX 5: Store the real error so the badge tooltip can show it
    _previewLastError = { message: msg, stack: stack };
    _setBadge('error', '\u26a0 Error: ' + msg.split('\n')[0].slice(0, 60));
  }
});

function syncPreviewIframe() {
  var project = selectedProject();

  // ── Regular preview panel ──
  var mount = document.getElementById('preview-mount');
  if (mount && state.currentTab === 'preview' && project) {
    var needsRender = (
      _previewMounted.projectId !== project.id ||
      _previewMounted.tab !== 'preview'
    );
    if (needsRender) {
      // Create iframe if it doesn't exist yet
      if (!_previewIframe) {
        _previewIframe = _createPreviewIframe('artemis-preview-iframe', false);
      }
      // Re-parent if needed (e.g. after HTML was rebuilt)
      if (_previewIframe.parentNode !== mount) {
        mount.appendChild(_previewIframe);
      }
      // Update srcdoc - this triggers a fresh compile inside the iframe
      var src = getPreviewSrcDoc(project);
      _previewIframe.srcdoc = src;
      _previewMounted.projectId = project.id;
      _previewMounted.tab = 'preview';
      _setBadge('', 'Compiling…');
    } else {
      // Make sure the iframe is still mounted (DOM may have been rebuilt)
      if (!mount.contains(_previewIframe)) {
        mount.appendChild(_previewIframe);
      }
    }
  }

  // ── Fullscreen preview overlay ──
  var mountFs = document.getElementById('preview-mount-fullscreen');
  if (mountFs && state.fullscreenPreview && project) {
    if (!_previewIframeFs) {
      _previewIframeFs = _createPreviewIframe('artemis-preview-iframe-fs', true);
    }
    if (_previewIframeFs.parentNode !== mountFs) {
      mountFs.appendChild(_previewIframeFs);
    }
    if (_previewMountedFs.projectId !== project.id) {
      _previewIframeFs.srcdoc = getPreviewSrcDoc(project);
      _previewMountedFs.projectId = project.id;
    }
  }

  // ── Invalidate cache when project changes ──
  // If user refines the project, force a re-render on next preview open
  if (project && _previewMounted.projectId === project.id) {
    var storedProject = state.projects.find(function(p) { return p.id === project.id; });
    if (storedProject && storedProject.updatedAt !== (_previewMounted.updatedAt || null)) {
      _previewMounted.projectId = null; // force refresh
      _previewMountedFs.projectId = null;
    }
  }
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
      :root{
        color-scheme:light;
        --bg:${COLORS.bg};
        --panel:${COLORS.panel};
        --panel2:${COLORS.panel2};
        --accent:${COLORS.accent};
        --accent-h:${COLORS.accentHover};
        --accent-s:${COLORS.accentSubtle};
        --accent-t:${COLORS.accentText};
        --text:${COLORS.text};
        --muted:${COLORS.muted};
        --faint:${COLORS.faint};
        --line:${COLORS.line};
        --line2:${COLORS.line2};
        --code:${COLORS.codeBase};
        --sh:${COLORS.shadow};
        --sh-md:${COLORS.shadowMd};
        --sh-lg:${COLORS.shadowLg};
        --sh-st:${COLORS.shadowStrong};
        --r:12px;--r-sm:8px;--r-md:16px;--r-lg:20px;--r-xl:24px;--r-p:999px;
        --ease:0.18s cubic-bezier(0.4,0,0.2,1);
      }
      *{box-sizing:border-box;-webkit-font-smoothing:antialiased}
      html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:"Inter","Segoe UI",system-ui,Arial,sans-serif}
      body{overflow-x:hidden}
      button,input,textarea,select{font:inherit}
      button{cursor:pointer}
      p{line-height:1.7;margin:0}
      h1,h2,h3,h4{margin:0;line-height:1.1}
      .app-shell{
        min-height:100vh;
        background:radial-gradient(ellipse 80% 50% at 20% -10%,rgba(232,167,54,.10) 0%,transparent 60%),
          radial-gradient(ellipse 60% 40% at 80% 110%,rgba(250,239,217,.50) 0%,transparent 60%),var(--bg);
        color:var(--text);
      }
      .topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
        padding:14px 28px;background:rgba(255,253,249,.92);border-bottom:1px solid var(--line);
        backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);}
      .topbar-sep{width:1px;height:20px;background:var(--line);flex:0 0 auto}
      .logo{cursor:pointer}
      .brand-copy{display:flex;flex-direction:column;gap:1px}
      .brand-name{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:18px;font-weight:700;letter-spacing:.01em;color:var(--text);line-height:1.1}
      .brand-role{font-size:10px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--accent)}
      .logo-mark{width:34px;height:34px;background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);
        border-radius:var(--r-sm);flex:0 0 auto;position:relative;box-shadow:0 2px 8px rgba(232,167,54,.35);}
      .logo-mark span{position:absolute;display:block}
      .logo-mark span:nth-child(1){left:8px;top:7px;width:14px;height:14px;border:1.5px solid rgba(255,255,255,.9);border-radius:3px}
      .logo-mark span:nth-child(2){left:16px;top:6px;width:1.5px;height:20px;background:rgba(255,255,255,.9)}
      .logo-mark span:nth-child(3){right:7px;bottom:7px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.9)}
      .topbar-search{flex:1;min-width:200px;max-width:380px}
      .topbar-search input,.auth-card input,.form-grid input,.refine-row input{
        width:100%;border:1.5px solid var(--line);border-radius:var(--r);
        background:var(--panel);color:var(--text);padding:10px 14px;outline:none;font-size:14px;
        transition:border-color var(--ease),box-shadow var(--ease);}
      .topbar-search input::placeholder,.form-grid input::placeholder,.refine-row input::placeholder{color:var(--faint)}
      .topbar-search input:focus,.auth-card input:focus,.form-grid input:focus{
        border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,167,54,.15);}
      .user-chip{display:flex;align-items:center;gap:10px;padding:7px 14px 7px 8px;
        border:1.5px solid var(--line);border-radius:var(--r-p);background:var(--panel);
        transition:border-color var(--ease);}
      .user-chip:hover{border-color:var(--line2)}
      .avatar{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;
        background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);
        color:#fff;font-weight:700;font-size:11px;flex:0 0 auto;}
      .user-name{font-weight:600;font-size:13px;line-height:1.2}
      .user-email{font-size:11px;color:var(--muted);line-height:1.2}
      .primary-btn{background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);
        color:#fff;border:none;border-radius:var(--r-p);padding:11px 20px;
        font-weight:600;font-size:13px;line-height:1;white-space:nowrap;
        box-shadow:0 2px 8px rgba(232,167,54,.30);
        transition:transform var(--ease),box-shadow var(--ease),opacity var(--ease);}
      .primary-btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(232,167,54,.40)}
      .primary-btn:active{transform:translateY(0)}
      .primary-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
      .primary-btn.full{width:100%;border-radius:var(--r-md);padding:14px 20px;font-size:14px}
      .primary-btn.danger{background:linear-gradient(135deg,#E53935 0%,#C62828 100%);box-shadow:0 2px 8px rgba(229,57,53,.30)}
      .primary-btn.danger:hover{box-shadow:0 4px 16px rgba(229,57,53,.40)}
      .ghost-btn{background:transparent;color:var(--text);border:1.5px solid var(--line);
        border-radius:var(--r-p);padding:10px 18px;font-weight:600;font-size:13px;line-height:1;white-space:nowrap;
        transition:border-color var(--ease),background var(--ease),transform var(--ease);}
      .ghost-btn:hover{border-color:var(--line2);background:var(--panel2);transform:translateY(-1px)}
      .ghost-btn:disabled{opacity:.5;cursor:not-allowed}
      .text-pill{background:transparent;color:var(--muted);border:1.5px solid transparent;
        border-radius:var(--r-p);padding:9px 16px;font-weight:600;font-size:12px;line-height:1;
        transition:color var(--ease),background var(--ease),border-color var(--ease);}
      .text-pill:hover{color:var(--text);background:var(--panel2)}
      .text-pill.active{background:var(--accent-s);color:var(--accent-t);border-color:rgba(232,167,54,.35)}
      .mini-link{background:transparent;border:none;padding:6px 10px;font-size:11px;font-weight:600;
        color:var(--muted);border-radius:var(--r-sm);transition:color var(--ease),background var(--ease);}
      .mini-link:hover{color:var(--text);background:var(--panel2)}
      .mini-link.danger{color:var(--faint)}
      .mini-link.danger:hover{color:#C62828;background:#FFF5F5}
      .text-link{width:100%;border:none;background:transparent;color:var(--muted);font-size:13px;
        padding:8px 0;margin-top:8px;transition:color var(--ease);}
      .text-link:hover{color:var(--text)}
      .save-pill{margin-left:auto;padding:8px 14px;border-radius:var(--r-p);
        background:var(--accent-s);border:1.5px solid rgba(232,167,54,.30);
        font-size:12px;font-weight:600;color:var(--accent-t);animation:fadeIn .3s ease;}
      .page{max-width:1280px;margin:0 auto;padding:36px 28px 80px}
      .page.narrow{max-width:980px}
      .builder-page{max-width:1080px;margin:0 auto;padding:40px 28px 80px}
      .page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:28px}
      .page-head h1{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:clamp(28px,4vw,42px);letter-spacing:-.04em;color:var(--text)}
      .page-head p{color:var(--muted);font-size:13px;padding-bottom:4px}
      .project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
      .project-card{background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);
        box-shadow:var(--sh);padding:22px;display:flex;flex-direction:column;min-height:220px;
        position:relative;cursor:pointer;
        transition:border-color var(--ease),box-shadow var(--ease),transform var(--ease);}
      .project-card:hover{border-color:var(--accent);box-shadow:var(--sh-md),0 0 0 3px rgba(232,167,54,.10);transform:translateY(-2px)}
      .project-card h3{margin:0 0 8px;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:18px;letter-spacing:-.03em;line-height:1.2}
      .project-card p{margin:0;color:var(--muted);line-height:1.6;font-size:13px;
        display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .project-card-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
      .mini-mark{width:44px;height:44px;border-radius:var(--r-sm);
        background:linear-gradient(135deg,var(--accent-s) 0%,rgba(250,239,217,.5) 100%);
        border:1.5px solid rgba(232,167,54,.25);display:flex;align-items:center;justify-content:center;font-size:18px;}
      .project-meta{display:flex;align-items:center;justify-content:space-between;
        margin-top:auto;padding-top:14px;border-top:1px solid var(--line);color:var(--faint);font-size:11px;font-weight:500;}
      .project-meta-badge{padding:3px 8px;border-radius:var(--r-p);background:var(--panel2);
        border:1px solid var(--line);font-size:10px;font-weight:600;color:var(--muted);letter-spacing:.04em;}
      .create-card{background:var(--panel);border:2px dashed var(--line2);border-radius:var(--r-xl);
        padding:22px;display:flex;flex-direction:column;min-height:220px;
        justify-content:center;align-items:center;gap:12px;text-align:center;cursor:pointer;
        transition:border-color var(--ease),background var(--ease),transform var(--ease);}
      .create-card:hover{border-color:var(--accent);background:var(--accent-s);transform:translateY(-2px)}
      .create-plus{width:52px;height:52px;border-radius:var(--r-md);
        background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);
        display:grid;place-items:center;font-size:22px;font-weight:300;color:#fff;
        box-shadow:0 4px 12px rgba(232,167,54,.35);}
      .create-card strong{font-size:16px;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;color:var(--text)}
      .create-card span{color:var(--muted);line-height:1.5;font-size:13px;max-width:24ch}
      .empty-state{grid-column:1/-1;padding:64px 24px;text-align:center;
        display:flex;flex-direction:column;align-items:center;gap:16px;}
      .empty-icon{width:64px;height:64px;border-radius:var(--r-md);background:var(--accent-s);
        border:2px solid rgba(232,167,54,.25);display:grid;place-items:center;font-size:28px;}
      .empty-state h3{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:24px;letter-spacing:-.03em}
      .empty-state p{color:var(--muted);max-width:38ch;line-height:1.7;font-size:14px}
      .auth-layout{max-width:1100px;margin:0 auto;min-height:100vh;padding:32px 28px;
        display:grid;grid-template-columns:1.1fr .9fr;gap:32px;align-items:center;}
      .hero-copy{padding:20px 16px 20px 8px}
      .hero-badge,.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;
        border:1.5px solid rgba(232,167,54,.35);border-radius:var(--r-p);background:var(--accent-s);
        font-size:10px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--accent-t);}
      .hero-copy h1{margin:22px 0 16px;max-width:13ch;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;
        font-size:clamp(40px,6.5vw,72px);line-height:.95;letter-spacing:-.06em;color:var(--text);}
      .hero-copy h1 em{font-style:normal;color:var(--accent)}
      .hero-copy p{max-width:52ch;color:var(--muted);line-height:1.8;font-size:15px}
      .hero-features{display:flex;flex-direction:column;gap:12px;margin-top:28px}
      .hero-feature{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted)}
      .hero-feature-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:0 0 auto;box-shadow:0 0 0 3px rgba(232,167,54,.20)}
      .auth-card{background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);box-shadow:var(--sh-md);padding:28px;}
      .auth-card-header{margin-bottom:22px}
      .auth-card-header h2{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:22px;letter-spacing:-.03em;margin-bottom:4px}
      .auth-card-header p{font-size:13px;color:var(--muted)}
      .auth-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:5px;
        background:var(--panel2);border:1.5px solid var(--line);border-radius:var(--r-md);margin-bottom:22px;}
      .auth-switch button{padding:10px 14px;border:none;border-radius:var(--r-sm);background:transparent;
        color:var(--muted);font-weight:600;font-size:13px;transition:background var(--ease),color var(--ease),box-shadow var(--ease);}
      .auth-switch button.active{background:var(--panel);color:var(--text);box-shadow:0 1px 4px rgba(26,18,8,.10),0 0 0 1px rgba(232,167,54,.20)}
      .form-grid{display:grid;gap:16px}
      .form-grid label{display:grid;gap:6px;font-size:13px;font-weight:500;color:var(--text)}
      .form-grid label span{color:var(--muted);font-weight:400}
      .password-row{display:flex;gap:8px}
      .password-row button{padding:10px 14px;border-radius:var(--r);border:1.5px solid var(--line);
        background:var(--panel);color:var(--text);font-size:13px;font-weight:600;white-space:nowrap;
        transition:border-color var(--ease),background var(--ease);}
      .password-row button:hover{border-color:var(--line2);background:var(--panel2)}
      .error-box{margin:14px 0 0;padding:13px 16px;border-radius:var(--r);
        border:1.5px solid rgba(229,57,53,.25);background:rgba(229,57,53,.06);
        color:#B71C1C;line-height:1.6;font-size:13px;display:flex;gap:10px;align-items:flex-start;}
      .error-box::before{content:"\26A0";flex:0 0 auto;margin-top:1px}
      .error-box.compact{margin:0;padding:10px 13px}
      .auth-note{margin-top:16px;font-size:12px;color:var(--faint);line-height:1.6;text-align:center}
      .builder-command{display:grid;gap:20px;border:1.5px solid var(--line);background:var(--panel);
        box-shadow:var(--sh-md);padding:28px;border-radius:var(--r-xl);}
      .builder-command h1{margin:0;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:clamp(32px,5vw,58px);
        line-height:.97;letter-spacing:-.05em;max-width:12ch;color:var(--text);}
      .builder-command p{margin:0;max-width:68ch;color:var(--muted);line-height:1.75;font-size:14px}
      .builder-command textarea{width:100%;resize:vertical;min-height:180px;
        border:1.5px solid var(--line);border-radius:var(--r-md);background:var(--bg);
        color:var(--text);padding:16px;outline:none;line-height:1.75;font-size:14px;
        transition:border-color var(--ease),box-shadow var(--ease);}
      .builder-command textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,167,54,.15)}
      .builder-command textarea::placeholder{color:var(--faint)}
      .mode-switch{width:fit-content;display:grid;grid-template-columns:1fr 1fr;gap:4px;
        padding:5px;border:1.5px solid var(--line);border-radius:var(--r-p);background:var(--panel2);}
      .mode-switch button{border:none;border-radius:var(--r-p);background:transparent;
        color:var(--muted);padding:9px 18px;font-weight:600;font-size:12px;transition:background var(--ease),color var(--ease);}
      .mode-switch button.active{background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);color:#fff;box-shadow:0 2px 8px rgba(232,167,54,.30)}
      .button-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
      .build-status{display:flex;align-items:center;gap:14px;border:1.5px solid var(--accent);
        background:var(--accent-s);border-radius:var(--r-md);padding:14px 16px;animation:fadeIn .3s ease;}
      .build-status strong{display:block;margin-bottom:3px;color:var(--accent-t)}
      .build-status span{display:block;color:var(--muted);font-size:13px;line-height:1.5}
      .pulse-dot{width:12px;height:12px;flex:0 0 12px;border-radius:50%;background:var(--accent);
        box-shadow:0 0 0 0 rgba(232,167,54,.45);animation:pulse 1.2s infinite;}
      .build-log{display:grid;gap:6px;border-left:2px solid rgba(232,167,54,.25);margin-left:6px;padding-left:16px;color:var(--muted);font-size:13px;line-height:1.5}
      .build-log-item{display:flex;align-items:center;gap:8px}
      .build-log-item::before{content:"\B7";color:var(--accent);font-size:18px;line-height:1}
      .plan-card{display:grid;gap:16px;margin-top:4px;border:1.5px solid rgba(232,167,54,.35);
        border-radius:var(--r-xl);padding:22px;
        background:linear-gradient(135deg,var(--accent-s) 0%,var(--panel) 100%);animation:fadeIn .35s ease;}
      .plan-card h2{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:26px;letter-spacing:-.04em;color:var(--text)}
      .plan-card p{color:var(--muted);font-size:14px}
      .plan-grid,.plan-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .plan-grid div,.plan-columns div{display:grid;gap:7px;border:1.5px solid var(--line);border-radius:var(--r-md);padding:14px;background:var(--panel)}
      .plan-grid strong,.plan-columns strong{font-size:10px;text-transform:uppercase;letter-spacing:.20em;color:var(--muted);font-weight:700}
      .plan-grid span,.plan-columns span{color:var(--text);line-height:1.5;font-size:13px}
      .examples{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
      .example-chip{padding:9px 14px;border-radius:var(--r-p);background:var(--panel2);border:1.5px solid var(--line);
        font-size:12px;color:var(--muted);font-weight:500;transition:border-color var(--ease),background var(--ease),color var(--ease);}
      .example-chip:hover{border-color:var(--accent);background:var(--accent-s);color:var(--accent-t)}
      .workspace{max-width:1440px;margin:0 auto;padding:20px 24px 0;display:grid;grid-template-columns:260px 1fr;gap:20px;min-height:calc(100vh - 64px)}
      .sidebar{background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);box-shadow:var(--sh);
        overflow:hidden;display:flex;flex-direction:column;height:fit-content;max-height:calc(100vh - 100px);position:sticky;top:80px;}
      .sidebar.hidden{display:none}
      .sidebar-head{padding:14px 16px;border-bottom:1px solid var(--line);font-size:10px;font-weight:700;
        letter-spacing:.22em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between;align-items:center;background:var(--panel2);}
      .sidebar-count{padding:2px 7px;border-radius:var(--r-p);background:var(--accent-s);
        color:var(--accent-t);font-size:10px;font-weight:700;border:1px solid rgba(232,167,54,.25);}
      .file-list{overflow-y:auto;flex:1}
      .file-list::-webkit-scrollbar{width:4px}
      .file-list::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}
      .file-row{width:100%;display:flex;align-items:center;gap:10px;padding:11px 16px;border:none;
        border-bottom:1px solid var(--line);background:transparent;color:var(--text);text-align:left;border-radius:0;cursor:pointer;
        transition:background var(--ease),color var(--ease);}
      .file-row:hover{background:var(--panel2)}
      .file-row.active{background:var(--accent-s);border-left:3px solid var(--accent);padding-left:13px}
      .file-tag{width:38px;flex:0 0 38px;font-size:9px;letter-spacing:.14em;font-weight:700;
        color:var(--accent);background:rgba(232,167,54,.12);padding:2px 4px;border-radius:4px;text-align:center;}
      .file-row.active .file-tag{color:var(--accent-t);background:rgba(232,167,54,.25)}
      .file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}
      .main-panel{background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);box-shadow:var(--sh);overflow:hidden;display:flex;flex-direction:column;min-height:60vh}
      .panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 18px;border-bottom:1px solid var(--line);background:var(--panel2);}
      .panel-file{font-weight:600;font-size:13px;color:var(--text);font-family:"SFMono-Regular","Fira Code",Consolas,"Liberation Mono",Menlo,monospace}
      .panel-badges{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .badge{padding:5px 10px;border-radius:var(--r-p);border:1px solid var(--line);background:var(--panel);font-size:10px;font-weight:600;color:var(--muted);letter-spacing:.04em;}
      .badge.accent{background:var(--accent-s);border-color:rgba(232,167,54,.30);color:var(--accent-t)}
      .code-block{margin:0;padding:22px;overflow:auto;flex:1;font-family:"SFMono-Regular","Fira Code",Consolas,"Liberation Mono",Menlo,monospace;font-size:12.5px;line-height:1.85;background:var(--code);color:#F2E8D9;tab-size:2}
      .code-block::-webkit-scrollbar{width:6px;height:6px}
      .code-block::-webkit-scrollbar-thumb{background:rgba(242,232,217,.2);border-radius:4px}
      .preview-shell{margin:0;overflow:hidden;flex:1;display:flex;flex-direction:column;border-radius:0;box-shadow:none;background:var(--panel)}
      .preview-badge{margin-left:auto;font-size:10px;padding:3px 9px;border-radius:var(--r-p);background:var(--panel2);color:var(--faint);border:1px solid var(--line);display:none;font-weight:600}
      .preview-badge.error{background:#FFF5F5;color:#C62828;border-color:rgba(229,57,53,.3);display:inline-block}
      .preview-badge.ready{background:var(--accent-s);color:var(--accent-t);border-color:rgba(232,167,54,.3);display:inline-block}
      .preview-iframe-persistent{width:100%;height:100%;border:none;background:#fff;display:block}
      .browser-bar{height:42px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--panel2)}
      .traffic{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
      .traffic.red{background:#FF5F57}.traffic.yellow{background:#FFBD2E}.traffic.green{background:#28CA41}
      .address-pill{margin-left:8px;height:22px;display:flex;align-items:center;padding:0 10px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--panel);font-size:11px;color:var(--muted);font-family:"SFMono-Regular","Fira Code",Consolas,"Liberation Mono",Menlo,monospace}
      iframe{width:100%;flex:1;border:none;background:#fff}
      .sandbox-note{padding:10px 16px;border-top:1px solid var(--line);font-size:11px;line-height:1.6;color:var(--faint);background:var(--panel2)}
      .preview-overlay{position:fixed;inset:0;z-index:80;background:var(--panel);display:flex;flex-direction:column}
      .preview-overlay-head{min-height:60px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
      .preview-overlay-head div{display:grid;gap:2px;min-width:0}
      .preview-overlay-head strong{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:16px;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .preview-overlay-head span{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .preview-overlay iframe{height:calc(100vh - 60px);flex:1}
      .delete-confirm-overlay{position:fixed;inset:0;z-index:90;background:rgba(26,18,8,.50);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .2s ease}
      .delete-confirm-box{background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);padding:32px;max-width:400px;width:100%;box-shadow:var(--sh-lg);animation:slideUp .2s ease}
      .delete-confirm-box h3{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:20px;letter-spacing:-.03em;margin-bottom:10px}
      .delete-confirm-box p{color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:24px}
      .delete-confirm-btns{display:flex;gap:10px;justify-content:flex-end}
      .setup-grid{padding:20px;display:grid;gap:20px}
      .setup-block{background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);box-shadow:var(--sh);padding:22px}
      .setup-block h2{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:20px;letter-spacing:-.03em;margin-bottom:16px}
      .setup-list{display:grid;gap:12px}
      .setup-item{display:flex;gap:14px;align-items:flex-start;font-size:13px;line-height:1.6;color:var(--text)}
      .setup-item code,.tree-box{display:block;width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r);background:var(--code);color:#F2E8D9;font-family:"SFMono-Regular","Fira Code",Consolas,"Liberation Mono",Menlo,monospace;font-size:12px;line-height:1.7;white-space:pre-wrap}
      .setup-step{width:26px;height:26px;flex:0 0 26px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);color:#fff;font-size:10px;font-weight:700;box-shadow:0 2px 6px rgba(232,167,54,.35)}
      .setup-step.light{background:var(--panel2);color:var(--muted);border:1.5px solid var(--line);box-shadow:none}
      .refine-bar{max-width:1440px;margin:0 auto;padding:16px 24px 28px}
      .refine-row{display:flex;gap:10px;align-items:center;background:var(--panel);border:1.5px solid var(--line);border-radius:var(--r-xl);padding:8px 8px 8px 16px;box-shadow:var(--sh);transition:border-color var(--ease),box-shadow var(--ease);}
      .refine-row:focus-within{border-color:var(--accent);box-shadow:var(--sh),0 0 0 3px rgba(232,167,54,.12)}
      .refine-row input{flex:1;border:none;background:transparent;padding:8px 4px;font-size:14px;outline:none;color:var(--text)}
      .refine-row input::placeholder{color:var(--faint)}
      .row-between{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
      .hint{color:var(--faint);font-size:12px;display:flex;align-items:center;gap:6px}
      kbd{display:inline-block;padding:2px 7px;border:1px solid var(--line);border-bottom-width:2px;border-radius:var(--r-sm);background:var(--panel);color:var(--text);font-family:"SFMono-Regular","Fira Code",Consolas,"Liberation Mono",Menlo,monospace;font-size:11px;font-weight:600}
      .topbar-title{min-width:0;display:flex;flex-direction:column;gap:2px;margin-right:auto}
      .title-main{font-weight:700;font-size:14px;color:var(--text)}
      .title-sub{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55vw}
      .root-frame{min-height:100vh;display:grid;place-items:center;position:relative;overflow:hidden;background:var(--bg)}
      .root-frame-bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 20% -10%,rgba(232,167,54,.12) 0%,transparent 60%),radial-gradient(ellipse 60% 40% at 80% 110%,rgba(250,239,217,.55) 0%,transparent 60%)}
      .stack{text-align:center;position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:16px}
      .logo-wordmark{display:flex;align-items:center;justify-content:center;gap:14px;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;font-size:44px;letter-spacing:-.05em;color:var(--text)}
      .logo-mark-inline{width:36px;height:36px;background:linear-gradient(135deg,var(--accent) 0%,var(--accent-h) 100%);border-radius:var(--r-sm);position:relative;display:inline-block;box-shadow:0 4px 16px rgba(232,167,54,.40)}
      .logo-mark-inline::before{content:"";position:absolute;left:12px;top:0;width:2px;height:36px;background:rgba(255,255,255,.85)}
      .logo-mark-inline::after{content:"";position:absolute;right:6px;bottom:6px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.90)}
      .logo-kicker{font-size:11px;font-weight:600;letter-spacing:.34em;text-transform:uppercase;color:var(--muted)}
      .boot-spinner{width:32px;height:32px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
      .ring{position:absolute;border-radius:50%;pointer-events:none;border:1px solid rgba(232,167,54,.08)}
      .ring.one{width:640px;height:640px;top:-200px;left:-180px}
      .ring.two{width:480px;height:480px;right:-140px;bottom:-180px}
      @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(232,167,54,.45)}70%{box-shadow:0 0 0 10px rgba(232,167,54,0)}100%{box-shadow:0 0 0 0 rgba(232,167,54,0)}}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
      @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
      @media(max-width:1024px){.workspace{grid-template-columns:240px 1fr;gap:16px}}
      @media(max-width:960px){.auth-layout,.workspace{grid-template-columns:1fr}.topbar{padding:12px 16px}.workspace{padding:14px 16px 0}.refine-bar{padding:12px 16px 24px}.plan-grid,.plan-columns{grid-template-columns:1fr}.sidebar{position:static;max-height:280px}}
      @media(max-width:720px){.topbar{gap:8px}.title-sub{display:none}.page{padding:24px 16px 60px}.auth-layout{padding:16px;min-height:auto}.hero-copy h1{font-size:clamp(34px,10vw,52px)}.builder-page{padding:18px 14px 56px}.builder-command{padding:20px;border-radius:var(--r-lg)}.row-between{align-items:stretch;flex-direction:column}.button-row{justify-content:stretch}.button-row button{width:100%}.panel-badges{flex-wrap:wrap;justify-content:flex-end}.preview-overlay-head{align-items:flex-start;flex-direction:column;gap:10px}.project-grid{grid-template-columns:1fr}.hero-features{display:none}.workspace{gap:12px}}
    </style>
    ${state.screen === "auth" ? authView() : ""}
    ${state.screen === "dashboard" ? dashboardView() : ""}
    ${state.screen === "new" ? newProjectView() : ""}
    ${state.screen === "project" ? projectView() : ""}
    ${fullscreenPreviewView()}
    ${state.pendingDeleteId ? deletionConfirmBanner() : ""}
  `;
  // Sync persistent preview iframe after every DOM update
  if (typeof syncPreviewIframe === 'function') {
    requestAnimationFrame(syncPreviewIframe);
  }
}

async function loadCurrentUser() {
  const email = sessionUserEmail();
  if (!email) return null;
  return getUser(email);
}

async function refreshProjects() {
  if (!state.user) {
    setState({ projects: [] });
    return [];
  }
  const projects = await listProjects(state.user.email);
  setState({ projects });
  return projects;
}

async function bootstrap() {
  // A1: Distinguish DB failures from genuine logged-out state
  // A4: Do not auto-open any project — land on dashboard
  // A6: Clean up stale session keys whose user records no longer exist
  try {
    const email = sessionUserEmail();
    if (!email) {
      state.screen = 'auth';
      setState({ booting: false });
      return;
    }

    let user;
    try {
      user = await getUser(email);
    } catch (dbErr) {
      // DB unavailable — show a clear error, keep the user on a loading/error screen
      // rather than silently dropping them to login and losing their session
      setState({
        booting: false,
        screen: 'auth',
        error:
          'Artemis could not open its local database. ' +
          'Try reloading the page. If the problem persists, check that ' +
          'your browser allows site storage (Settings → Privacy → Site Data). ' +
          '(' + (dbErr.message || 'IndexedDB error') + ')',
      });
      return;
    }

    if (!user) {
      // A6: Session email points to a missing user record — clear the stale key
      setSessionUserEmail('');
      state.screen = 'auth';
      setState({ booting: false });
      return;
    }

    const projects = await listProjects(user.email);
    state.screen = 'dashboard';
    setState({
      user,
      projects,
      currentProjectId: null,   // A4: always land on dashboard, not a project
      currentTab: 'code',
      booting: false,
      error: '',
    });
  } catch (error) {
    // Unexpected error — show it but don't leave the user on a blank screen
    state.screen = 'auth';
    setState({
      booting: false,
      error: 'Startup error: ' + (error.message || String(error)),
    });
  } finally {
    render();
  }
}

function parseJsonResponse(text) {
  // B10: Robust JSON extraction that handles:
  //   - markdown fences ('''json ... ''')
  //   - leading/trailing whitespace and prose
  //   - truncated responses (finds last valid closing brace via a scan)
  const raw = String(text || '').trim();

  // Strip markdown fences
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 1. Direct parse (fast path – covers well-formed responses)
  try { return JSON.parse(cleaned); } catch (_) {}

  // 2. Find the outermost { ... } by tracking brace depth
  //    This correctly handles } inside string values.
  const start = cleaned.indexOf('{');
  if (start < 0) {
    throw new Error(
      'The AI response contained no JSON object. ' +
      'Try a simpler prompt or use Plan first mode.'
    );
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
  }

  // 3. Last-resort: try progressively shorter slices to recover truncated JSON
  //    (handles responses cut off mid-string by token limit)
  if (end < 0) end = cleaned.length - 1;
  for (let tail = end; tail > start + 10; tail--) {
    if (cleaned[tail] !== '}' && cleaned[tail] !== ']') continue;
    try { return JSON.parse(cleaned.slice(start, tail + 1)); } catch (_) { continue; }
  }

  throw new Error(
    'Artemis could not parse the AI response as JSON. ' +
    'The response may have been cut off (token limit). ' +
    'Try a shorter prompt or use Plan first to break it into smaller steps.'
  );
}

function buildGeneratePrompt(prompt) {
  return `Build this website or web app: ${prompt}

Make it feel like a finished frontend product:
- responsive desktop/tablet/mobile layouts
- strong visual hierarchy and clean black/white styling
- useful interactions, hover/focus states, and tasteful animations
- realistic content, empty states, and clear calls to action
- multiple files when helpful, not just one HTML file
- include notes explaining what was created and how it can improve`;
}

function buildRefinePrompt(basePrompt, currentFilesText, refinement) {
  // B9: Trim file content to avoid blowing the context window.
  // Keep the full content of smaller files; truncate large ones.
  const MAX_CONTEXT_CHARS = 12000; // ~3000 tokens of file context is plenty
  let context = currentFilesText || '';
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS) +
      '\n\n[...file content trimmed to fit context window — preserve existing structure...]';
  }
  return `You are refining an existing web app.
Original brief: ${basePrompt}
Current files: ${context}
Requested change: ${refinement}

Return the COMPLETE updated project as strict JSON with ALL files.`;
}

async function planProjectIdea(prompt) {
  const body = {
    system: planPrompt,
    messages: [
      {
        role: "user",
        content: `Plan this website or web app idea: ${prompt}`,
      },
    ],
    max_tokens: 1800,
    temperature: 0.25,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  };

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok || data.error || data.type === "error") {
    throw new Error(data.error?.message || data.error || `Server error ${response.status}`);
  }

  const text = Array.isArray(data.content) ? data.content.map((item) => item.text || "").join("") : "";
  if (!text.trim()) throw new Error("Empty planning response from Artemis.");
  return parseJsonResponse(text);
}

async function generateProject(basePrompt, existingProject = null) {
  const currentFilesText = existingProject?.result?.files?.map((file) => `${file.path}\n${file.content}`).join("\n\n") || "";
  const body = {
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: existingProject
          ? buildRefinePrompt(existingProject.prompt, currentFilesText, basePrompt)
          : buildGeneratePrompt(basePrompt),
      },
    ],
    max_tokens: 8192,
    temperature: 0.2,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  };

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok || data.error || data.type === "error") {
    throw new Error(data.error?.message || data.error || `Server error ${response.status}`);
  }

  const text = Array.isArray(data.content) ? data.content.map((item) => item.text || "").join("") : "";
  if (!text.trim()) {
    throw new Error("Empty response from the generator.");
  }
  return parseJsonResponse(text);
}

async function submitAuth() {
  // A5: Double-submit guard
  if (state.busy) return;

  const { name, email, password } = state.authForm;
  const isSignup = state.authMode === 'signup';

  // ── Field presence ───────────────────────────────────────────────────────
  if (!email.trim() || !password.trim() || (isSignup && !name.trim())) {
    setState({ error: 'Please fill in all required fields.' });
    return;
  }

  // A2: Email format validation
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(email.trim())) {
    setState({ error: 'Please enter a valid email address.' });
    return;
  }

  // A3: Password minimum length (6 chars is a sensible low bar for a demo)
  if (password.length < 6) {
    setState({ error: 'Password must be at least 6 characters.' });
    return;
  }

  setState({ busy: true, error: '' });
  try {
    const normalizedEmail = email.trim().toLowerCase();

    if (isSignup) {
      const existing = await getUser(normalizedEmail);
      if (existing) throw new Error('An account with this email already exists.');
      const user = {
        email: normalizedEmail,
        name: name.trim().slice(0, 80),   // cap name length
        passwordHash: await sha256(password),
        createdAt: nowIso(),
      };
      await saveUser(user);
      setSessionUserEmail(normalizedEmail);
      const projects = await listProjects(normalizedEmail);
      state.screen = 'dashboard';
      setState({
        user,
        projects,
        currentProjectId: null,
        busy: false,
        authForm: { name: '', email: '', password: '' },
      });
      return;
    }

    // Login
    const user = await getUser(normalizedEmail);
    if (!user) throw new Error('No account found for that email address.');
    const hash = await sha256(password);
    if (hash !== user.passwordHash) throw new Error('Incorrect password.');
    setSessionUserEmail(normalizedEmail);
    const projects = await listProjects(normalizedEmail);
    state.screen = 'dashboard';
    setState({
      user,
      projects,
      currentProjectId: null,    // A4: always land on dashboard
      busy: false,
      authForm: { name: '', email: '', password: '' },
    });
  } catch (error) {
    setState({ busy: false, error: error.message || String(error) });
  }
}

async function createProject() {
  if (!state.newPrompt.trim() || state.busy) return;
  // P6: Guard against user becoming null mid-flow (e.g. another tab signed out)
  if (!state.user) {
    setState({ error: 'You have been signed out. Please sign in again.', screen: 'auth' });
    return;
  }

  setState({ busy: true, error: '', buildStage: 'Reading brief', buildDetails: [], lastPlan: state.lastPlan });
  const promptSnapshot = state.newPrompt.trim();  // snapshot before any async gap

  let result = null;
  try {
    await showBuildStage('Reading brief', 'Extracting product goals, audience, and required screens.');
    await showBuildStage('Designing experience', 'Choosing layout structure, responsive behavior, and motion moments.');
    await showBuildStage('Writing files', 'Generating project files, preview HTML, setup notes, and UX rationale.');
    result = await generateProject(promptSnapshot);
    await showBuildStage('Saving project', 'Storing the generated app in the local database.');
  } catch (genError) {
    setState({ busy: false, buildStage: '', error: genError.message || String(genError) });
    return;
  }

  // P6: Re-check user after async gap
  if (!state.user) {
    setState({
      busy: false, buildStage: '',
      error: 'You were signed out while the app was generating. ' +
             'Sign in again — your generated code is shown below.',
      screen: 'auth',
    });
    return;
  }

  // P1: Attempt save with retry — if it fails, preserve the result in state
  //     so the user can at least copy their code before the error is shown
  const project = {
    id: uid(),
    ownerEmail: state.user.email,
    name: sanitiseProjectName(result.appName) || 'Untitled App',   // P9
    description: String(result.description || promptSnapshot).trim().slice(0, 300),
    prompt: promptSnapshot,
    result,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  let saved = false;
  let saveError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await upsertProject(project);
      saved = true;
      break;
    } catch (dbErr) {
      saveError = dbErr;
      if (attempt === 0) await new Promise(r => setTimeout(r, 400)); // brief pause before retry
    }
  }

  if (!saved) {
    // P1: Save failed — still navigate to project view so user can copy their code
    const projects = await listProjects(state.user.email).catch(() => state.projects);
    state.screen = 'project';
    setState({
      projects,
      currentProjectId: null,              // no DB ID — show result in a temporary state
      currentTab: 'code',
      selectedFileIndex: 0,
      buildStage: '',
      buildDetails: [],
      busy: false,
      error: 'Generated successfully, but could not save to local storage. You can copy the code now. Error: ' + (saveError?.message || 'Storage write failed'),
      // Inject the unsaved project into projects list so it is visible
      projects: [project, ...state.projects],
    });
    // Set currentProjectId to the temporary project
    state.currentProjectId = project.id;
    render();
    return;
  }

  const projects = await listProjects(state.user.email);
  state.screen = 'project';
  setState({
    projects,
    currentProjectId: project.id,
    currentTab: 'code',
    selectedFileIndex: 0,
    newPrompt: '',
    refinePrompt: '',
    buildStage: '',
    buildDetails: [],
    lastPlan: null,
    busy: false,
  });
  notify('Project saved');
}

async function createPlan() {
  if (!state.newPrompt.trim() || state.busy) return;
  setState({ busy: true, error: "", buildStage: "Planning", buildDetails: [], lastPlan: null });
  try {
    await showBuildStage("Planning", "Mapping the web idea into screens, components, motion, and data.");
    await showBuildStage("Refining direction", "Turning the rough brief into a build-ready product plan.");
    const plan = await planProjectIdea(state.newPrompt.trim());
    setState({
      lastPlan: plan,
      newPrompt: plan.buildPrompt || state.newPrompt,
      busy: false,
      buildStage: "",
      buildDetails: [],
    });
    notify("Plan ready");
  } catch (error) {
    setState({ busy: false, buildStage: "", error: error.message || String(error) });
  }
}

async function buildFromPlan() {
  if (!state.lastPlan || state.busy) return;
  state.newPrompt = state.lastPlan.buildPrompt || state.newPrompt;
  state.buildMode = "build";
  await createProject();
}

async function refineProject() {
  const project = selectedProject();
  if (!project || !state.refinePrompt.trim() || state.busy) return;
  if (!state.user) {
    setState({ error: 'You have been signed out. Please sign in again.' });
    return;
  }

  setState({ busy: true, error: '', buildStage: 'Updating app', buildDetails: [] });
  const refinePromptSnapshot = state.refinePrompt.trim();

  let result = null;
  try {
    await showBuildStage('Reading current app', 'Reviewing the saved files and the requested refinement.');
    await showBuildStage('Applying improvement', 'Regenerating the project with updated UI, preview, and notes.');
    result = await generateProject(refinePromptSnapshot, project);
  } catch (genError) {
    setState({ busy: false, buildStage: '', error: genError.message || String(genError) });
    return;
  }

  // P2: Build updated object but keep original as rollback reference
  const original = project;
  const updated = {
    ...project,
    name: sanitiseProjectName(result.appName) || project.name,   // P9
    description: String(result.description || project.description).trim().slice(0, 300),
    result,
    updatedAt: nowIso(),
  };

  // Save with single retry
  let saved = false;
  let saveError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await upsertProject(updated);
      saved = true;
      break;
    } catch (dbErr) {
      saveError = dbErr;
      if (attempt === 0) await new Promise(r => setTimeout(r, 400));
    }
  }

  if (!saved) {
    // P2: Save failed — stay on current project with old data intact in DB
    //     Show the new result temporarily so the user can copy it
    setState({
      busy: false,
      buildStage: '',
      error:
        'Refinement generated but could not be saved. ' +
        'Your original project is safe. Error: ' + (saveError?.message || 'Storage write failed'),
    });
    return;
  }

  const projects = await listProjects(state.user.email).catch(() => state.projects);
  setState({
    projects,
    currentProjectId: updated.id,
    currentTab: 'code',
    selectedFileIndex: 0,
    refinePrompt: '',
    buildStage: '',
    buildDetails: [],
    busy: false,
  });
  notify('Project updated');
}

async function openProject(id) {
  // P4: use setState (not direct mutation) so screen change is atomic with rest of update
  // Verify the project exists before navigating to it
  const project = state.projects.find(p => p.id === id);
  if (!project) {
    setState({ error: 'Project not found.' });
    return;
  }
  setState({
    screen: 'project',
    currentProjectId: id,
    currentTab: 'code',
    selectedFileIndex: 0,
    error: '',
    notice: '',
    pendingDeleteId: null,
  });
}

async function removeProject(id) {
  const project = state.projects.find((item) => item.id === id);
  if (!project) return;

  // P3: Use in-app confirm state instead of window.confirm()
  // Set a pending deletion ID and re-render to show the confirmation UI
  setState({ pendingDeleteId: id });
  return;
}

async function confirmDeleteProject() {
  const id = state.pendingDeleteId;
  if (!id) return;
  setState({ pendingDeleteId: null, busy: true });

  try {
    await deleteProject(id);
  } catch (dbErr) {
    setState({ busy: false, error: 'Could not delete project: ' + (dbErr.message || 'Storage error') });
    return;
  }

  const projects = await listProjects(state.user.email).catch(() => []);

  // P5: Explicitly set screen and clear currentProjectId
  const wasCurrentProject = (state.currentProjectId === id);
  state.screen = 'dashboard';   // always land on dashboard after deletion

  setState({
    projects,
    currentProjectId: null,
    currentTab: 'code',
    selectedFileIndex: 0,
    busy: false,
  });
  notify('Project deleted');
}

function cancelDeleteProject() {
  setState({ pendingDeleteId: null });
}

function handleClick(event) {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === "auth-tab") {
    state.authMode = actionEl.dataset.mode;
    state.error = "";
    render();
    return;
  }

  if (action === "switch-auth-mode") {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    state.error = "";
    render();
    return;
  }

  if (action === "toggle-password") {
    state.showPassword = !state.showPassword;
    render();
    return;
  }

  if (action === "submit-auth") {
    submitAuth();
    return;
  }

  if (action === "new-project") {
    state.screen = "new";
    state.error = "";
    state.notice = "";
    state.buildStage = "";
    state.buildDetails = [];
    render();
    return;
  }

  if (action === "sign-out") {
    // A7: Reset everything including authMode, search (P10), and build state
    setSessionUserEmail('');
    Object.assign(state, {
      screen:           'auth',
      user:             null,
      projects:         [],
      currentProjectId: null,
      currentTab:       'code',
      selectedFileIndex: 0,
      authMode:         'login',          // A7: always return to login tab
      authForm:         { name: '', email: '', password: '' },
      newPrompt:        '',
      refinePrompt:     '',
      search:           '',               // P10: clear search between accounts
      lastPlan:         null,
      buildStage:       '',
      buildDetails:     [],
      fullscreenPreview: false,
      busy:             false,
      error:            '',
      notice:           '',
    });
    render();
    return;
  }

  if (action === "back-dashboard") {
    state.screen = "dashboard";
    state.error = "";
    render();
    return;
  }

  if (action === "generate-project") {
    createProject();
    return;
  }

  if (action === "plan-project") {
    createPlan();
    return;
  }

  if (action === "build-from-plan") {
    buildFromPlan();
    return;
  }

  if (action === "set-build-mode") {
    state.buildMode = actionEl.dataset.mode || "build";
    state.error = "";
    render();
    return;
  }

  if (action === "refine-project") {
    refineProject();
    return;
  }

  if (action === "fill-example") {
    state.newPrompt = actionEl.dataset.value || "";
    render();
    return;
  }

  if (action === "open-project") {
    const id = actionEl.dataset.id;
    if (id) openProject(id);
    return;
  }

  if (action === "delete-project") {
    event.stopPropagation();
    const id = actionEl.dataset.id;
    if (id) removeProject(id);
    return;
  }

  if (action === "confirm-delete") {
    confirmDeleteProject();
    return;
  }

  if (action === "cancel-delete") {
    cancelDeleteProject();
    return;
  }

  if (action === "switch-tab") {
    state.currentTab = actionEl.dataset.tab;
    render();
    return;
  }

  if (action === "open-fullscreen-preview") {
    state.fullscreenPreview = true;
    render();
    return;
  }

  if (action === "open-codesandbox") {
    openCodeSandbox(selectedProject());
    return;
  }

  if (action === "close-fullscreen-preview") {
    state.fullscreenPreview = false;
    render();
    return;
  }

  if (action === "select-file") {
    state.selectedFileIndex = Number(actionEl.dataset.index || 0);
    render();
    return;
  }

  if (action === "copy-code") {
    const project = selectedProject();
    const file = normalizeFiles(project?.result?.files || [])[state.selectedFileIndex];
    if (!file) return;
    navigator.clipboard.writeText(file.content || "").then(() => {
      notify("Code copied");
    });
  }
}

function handleInput(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  const value = event.target.value;

  if (field === "name" || field === "email" || field === "password") {
    state.authForm = { ...state.authForm, [field]: value };
    return;
  }

  if (field === "search") {
    state.search = value;
    render();
    return;
  }

  if (field === "newPrompt") {
    state.newPrompt = value;
    return;
  }

  if (field === "refinePrompt") {
    state.refinePrompt = value;
    return;
  }
}

function handleKeydown(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  if (event.key === "Enter" && (field === "email" || field === "password") && state.screen === "auth") {
    submitAuth();
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && state.screen === "new" && field === "newPrompt") {
    if (state.buildMode === "plan") createPlan();
    else createProject();
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && state.screen === "project" && field === "refinePrompt") {
    refineProject();
  }
}

root.addEventListener("click", handleClick);
root.addEventListener("input", handleInput);
root.addEventListener("keydown", handleKeydown);

root.innerHTML = `<div class="root-frame"><div class="stack"><div class="logo-wordmark"><span class="logo-mark-inline"></span><span>Artemis</span></div><div class="logo-kicker">Loading Studio</div></div></div>`;

bootstrap().finally(() => {
  render();
  state.booting = false;
});
