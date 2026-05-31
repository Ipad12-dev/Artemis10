const DB_NAME = "artemis-db";
const DB_VERSION = 1;
const SESSION_KEY = "artemis_session";
const root = document.getElementById("root");

document.title = "Artemis | Studio";

const COLORS = {
  bg: "#ffffff",
  panel: "#ffffff",
  panel2: "#f7f7f7",
  text: "#111111",
  muted: "#666666",
  faint: "#8a8a8a",
  line: "#d9d9d9",
  line2: "#c5c5c5",
  shadow: "0 18px 48px rgba(0, 0, 0, 0.08)",
  shadowStrong: "0 28px 70px rgba(0, 0, 0, 0.14)",
};

const SYSTEM_FONT = '"Inter", "Segoe UI", Arial, sans-serif';
const SERIF_FONT = '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
const CODE_FONT = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

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

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "email" });
      }
      if (!db.objectStoreNames.contains("projects")) {
        const store = db.createObjectStore("projects", { keyPath: "id" });
        store.createIndex("ownerEmail", "ownerEmail", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise = openDB();

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getUser(email) {
  const db = await dbPromise;
  const tx = db.transaction("users", "readonly");
  return requestToPromise(tx.objectStore("users").get(email));
}

async function saveUser(user) {
  const db = await dbPromise;
  const tx = db.transaction("users", "readwrite");
  await requestToPromise(tx.objectStore("users").put(user));
  return user;
}

async function listProjects(ownerEmail) {
  const db = await dbPromise;
  const tx = db.transaction("projects", "readonly");
  const items = await requestToPromise(tx.objectStore("projects").index("ownerEmail").getAll(ownerEmail));
  return (items || []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function upsertProject(project) {
  const db = await dbPromise;
  const tx = db.transaction("projects", "readwrite");
  await requestToPromise(tx.objectStore("projects").put(project));
  return project;
}

async function deleteProject(id) {
  const db = await dbPromise;
  const tx = db.transaction("projects", "readwrite");
  await requestToPromise(tx.objectStore("projects").delete(id));
  return true;
}

function sessionUserEmail() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setSessionUserEmail(email) {
  try {
    if (email) sessionStorage.setItem(SESSION_KEY, email);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {}
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
  state.buildStage = stage;
  state.buildDetails = [...state.buildDetails, detail].slice(-6);
  render();
  await delay(260);
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
  }));
}

function getPreviewSrcDoc(project) {
  const result = project?.result || {};
  if (typeof result.previewHtml === "string" && result.previewHtml.trim()) {
    return result.previewHtml;
  }

  const files = Array.isArray(result.files) ? normalizeFiles(result.files) : [];
  const htmlFile = files.find((file) => /\.html?$/.test(file.path));
  if (htmlFile?.content) {
    const css = files
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => file.content)
      .join("\n\n");
    if (css) {
      return htmlFile.content.replace("</head>", `<style>${css}</style></head>`);
    }
    return htmlFile.content;
  }

  const css = files
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.content)
    .join("\n\n");
  const js = files
    .filter((file) => file.path.endsWith(".js") || file.path.endsWith(".ts") || file.path.endsWith(".tsx") || file.path.endsWith(".jsx"))
    .map((file) => file.content)
    .join("\n\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root{color-scheme:light;}
    body{margin:0;font-family:${SYSTEM_FONT};background:#fff;color:#111;}
    main{min-height:100vh;display:grid;place-items:center;padding:32px;}
    .card{max-width:760px;width:100%;border:1px solid #ddd;border-radius:20px;padding:28px;box-shadow:${COLORS.shadow};}
    pre{white-space:pre-wrap;word-break:break-word;background:#fafafa;border:1px solid #eee;border-radius:14px;padding:16px;overflow:auto;}
    h1{font-family:${SERIF_FONT};font-size:40px;line-height:1.05;margin:0 0 12px;}
    p{margin:0 0 12px;color:#555;line-height:1.7;}
  </style>
  ${css ? `<style>${css}</style>` : ""}
</head>
<body>
  <main>
    <section class="card">
      <h1>${escapeHtml(project?.name || "Preview")}</h1>
      <p>The generated project did not include a standalone previewHtml, so this fallback view is showing the saved files.</p>
      <pre>${escapeHtml(js || "No renderable output found.")}</pre>
    </section>
  </main>
</body>
</html>`;
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
              <button class="mini-link" data-action="open-fullscreen-preview">Fullscreen</button>
            </div>
          </div>
          <div class="preview-shell">
            <div class="browser-bar">
              <span class="traffic red"></span>
              <span class="traffic yellow"></span>
              <span class="traffic green"></span>
              <div class="address-pill">${escapeHtml((project.name || "preview").toLowerCase().replace(/\s+/g, "-"))}.preview</div>
            </div>
            <iframe title="${escapeAttr(project.name)} preview" sandbox="allow-scripts" srcdoc="${escapeAttr(previewHtml)}"></iframe>
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
      <iframe title="${escapeAttr(project.name)} fullscreen preview" sandbox="allow-scripts" srcdoc="${escapeAttr(previewHtml)}"></iframe>
    </section>
  `;
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <style>
      :root{
        color-scheme: light;
        --bg:${COLORS.bg};
        --panel:${COLORS.panel};
        --panel2:${COLORS.panel2};
        --text:${COLORS.text};
        --muted:${COLORS.muted};
        --faint:${COLORS.faint};
        --line:${COLORS.line};
        --line2:${COLORS.line2};
        --shadow:${COLORS.shadow};
        --shadow-strong:${COLORS.shadowStrong};
      }
      *{box-sizing:border-box}
      html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:${SYSTEM_FONT};}
      body{overflow-x:hidden}
      button,input,textarea{font:inherit}
      button{cursor:pointer}
      .app-shell{min-height:100vh;background:
        radial-gradient(circle at top left, rgba(0,0,0,0.05), transparent 32%),
        radial-gradient(circle at bottom right, rgba(0,0,0,0.04), transparent 30%),
        var(--bg);
        color:var(--text);
      }
      .topbar{
        position:sticky;top:0;z-index:20;
        display:flex;align-items:center;gap:14px;flex-wrap:wrap;
        padding:16px 24px;background:rgba(255,255,255,0.9);
        border-bottom:1px solid var(--line);
        backdrop-filter:blur(18px);
      }
      .brand-copy{display:flex;flex-direction:column;gap:2px}
      .brand-name{font-family:${SERIF_FONT};font-size:20px;font-weight:700;letter-spacing:0.02em}
      .brand-role{font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:var(--muted)}
      .logo-mark{
        width:36px;height:36px;border:1px solid var(--text);border-radius:10px;
        position:relative;flex:0 0 auto;background:var(--bg);
      }
      .logo-mark span{position:absolute;display:block}
      .logo-mark span:nth-child(1){left:9px;top:8px;width:16px;height:16px;border:1px solid var(--text);border-radius:4px}
      .logo-mark span:nth-child(2){left:18px;top:7px;width:1px;height:22px;background:var(--text)}
      .logo-mark span:nth-child(3){right:8px;bottom:8px;width:5px;height:5px;border-radius:50%;background:var(--text)}
      .topbar-search{flex:1;min-width:240px;max-width:420px}
      .topbar-search input,.auth-card input,.editor-card textarea,.refine-row input{
        width:100%;border:1px solid var(--line);border-radius:14px;background:var(--bg);color:var(--text);
        padding:12px 14px;outline:none;transition:border-color .2s, box-shadow .2s;
      }
      .topbar-search input:focus,.auth-card input:focus,.editor-card textarea:focus,.refine-row input:focus{border-color:var(--text);box-shadow:0 0 0 3px rgba(0,0,0,0.06)}
      .user-chip{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg)}
      .avatar{
        width:30px;height:30px;border-radius:50%;display:grid;place-items:center;
        background:var(--text);color:var(--bg);font-weight:700;font-size:12px
      }
      .user-name{font-weight:600;font-size:13px;line-height:1.2}
      .user-email{font-size:11px;color:var(--muted)}
      .primary-btn,.ghost-btn,.text-pill,.mini-link,.example-chip,.auth-switch button,.text-link{
        border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--text);
        padding:11px 16px;line-height:1;font-weight:600;transition:transform .15s, background .15s, border-color .15s, opacity .15s;
      }
      .primary-btn{background:var(--text);color:var(--bg);border-color:var(--text)}
      .primary-btn:hover,.ghost-btn:hover,.text-pill:hover,.mini-link:hover,.example-chip:hover,.auth-switch button:hover,.text-link:hover{transform:translateY(-1px)}
      .primary-btn.full{width:100%;border-radius:14px;padding:14px 16px}
      .ghost-btn,.text-pill,.mini-link,.text-link{background:var(--bg)}
      .text-pill{padding:10px 14px;font-size:12px}
      .text-pill.active{background:var(--text);color:var(--bg);border-color:var(--text)}
      .save-pill{margin-left:auto;padding:9px 12px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);font-size:12px;font-weight:600}
      .page{max-width:1280px;margin:0 auto;padding:32px 24px 72px}
      .page.narrow{max-width:980px}
      .builder-page{max-width:1120px;margin:0 auto;padding:34px 24px 72px}
      .builder-command{display:grid;gap:16px;border:1px solid var(--line);background:rgba(255,255,255,.92);box-shadow:var(--shadow);padding:24px;border-radius:18px}
      .builder-command h1{margin:0;font-family:${SERIF_FONT};font-size:clamp(34px,6vw,64px);line-height:1;letter-spacing:-.05em;max-width:11ch}
      .builder-command p{margin:0;max-width:72ch;color:var(--muted);line-height:1.7}
      .builder-command textarea{width:100%;resize:vertical;min-height:190px;border:1px solid var(--line);border-radius:16px;background:#fff;color:var(--text);padding:16px;outline:none;line-height:1.7}
      .builder-command textarea:focus{border-color:var(--text);box-shadow:0 0 0 3px rgba(0,0,0,.06)}
      .mode-switch{width:fit-content;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;border:1px solid var(--line);border-radius:999px;background:#f7f7f7}
      .mode-switch button{border:none;border-radius:999px;background:transparent;color:var(--muted);padding:10px 14px;font-weight:700;font-size:12px}
      .mode-switch button.active{background:#111;color:#fff}
      .button-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
      .build-status{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:#fafafa;border-radius:16px;padding:13px 14px}
      .build-status strong{display:block;margin-bottom:3px}
      .build-status span{display:block;color:var(--muted);font-size:13px;line-height:1.5}
      .pulse-dot{width:12px;height:12px;border-radius:50%;background:#111;box-shadow:0 0 0 0 rgba(0,0,0,.28);animation:pulse 1.1s infinite}
      .build-log{display:grid;gap:6px;border-left:1px solid var(--line);margin-left:6px;padding-left:16px;color:var(--muted);font-size:13px;line-height:1.5}
      .plan-card{display:grid;gap:14px;margin-top:4px;border:1px solid #111;border-radius:18px;padding:20px;background:#fff}
      .plan-card h2{margin:0;font-family:${SERIF_FONT};font-size:28px;letter-spacing:-.04em}
      .plan-card p{margin:0}
      .plan-grid,.plan-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .plan-grid div,.plan-columns div{display:grid;gap:7px;border:1px solid var(--line);border-radius:14px;padding:13px;background:#fafafa}
      .plan-grid strong,.plan-columns strong{font-size:12px;text-transform:uppercase;letter-spacing:.18em}
      .plan-grid span,.plan-columns span{color:var(--muted);line-height:1.5}
      .page-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}
      .page-head h1{margin:0;font-family:${SERIF_FONT};font-size:clamp(30px,5vw,48px);letter-spacing:-0.04em}
      .page-head p{margin:0;color:var(--muted)}
      .project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
      .project-card,.create-card,.auth-card,.editor-card,.setup-block,.sidebar,.main-panel,.preview-shell{background:var(--bg);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow)}
      .project-card,.create-card{padding:20px;display:flex;flex-direction:column;min-height:210px;position:relative}
      .project-card{cursor:pointer}
      .project-card:hover,.create-card:hover{border-color:var(--line2);box-shadow:var(--shadow-strong)}
      .project-card h3,.editor-card h1,.setup-block h2{margin:0 0 10px;font-family:${SERIF_FONT};letter-spacing:-0.03em}
      .project-card p,.editor-card p{margin:0;color:var(--muted);line-height:1.6}
      .project-card-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px}
      .mini-mark{width:42px;height:42px;border-radius:14px;border:1px solid var(--line);background:linear-gradient(180deg,#fff,#f5f5f5)}
      .mini-link{padding:7px 11px;font-size:11px}
      .mini-link.danger{color:#777}
      .project-meta{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
      .create-card{justify-content:center;align-items:center;gap:10px;text-align:center;border-style:dashed;background:linear-gradient(180deg,#fff,#fafafa)}
      .create-plus{width:52px;height:52px;border-radius:18px;border:1px dashed var(--line2);display:grid;place-items:center;font-size:24px;font-weight:300}
      .create-card strong{font-size:18px;font-family:${SERIF_FONT}}
      .create-card span{color:var(--muted);line-height:1.5}
      .auth-layout{max-width:1180px;margin:0 auto;min-height:100vh;padding:28px;display:grid;grid-template-columns:1.2fr .9fr;gap:24px;align-items:center}
      .hero-copy{padding:24px 12px}
      .hero-badge,.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg);font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted)}
      .hero-copy h1{margin:18px 0 14px;max-width:12ch;font-family:${SERIF_FONT};font-size:clamp(42px,7vw,78px);line-height:.96;letter-spacing:-.06em}
      .hero-copy p{margin:0;max-width:56ch;color:var(--muted);line-height:1.8;font-size:16px}
      .auth-card{padding:24px}
      .auth-switch{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px;background:var(--panel2);border:1px solid var(--line);border-radius:18px;margin-bottom:18px}
      .auth-switch button{padding:12px 14px;border:none;border-radius:13px;background:transparent;color:var(--muted)}
      .auth-switch button.active{background:var(--bg);color:var(--text);box-shadow:var(--shadow)}
      .form-grid{display:grid;gap:12px}
      .form-grid label{display:grid;gap:8px;color:var(--muted);font-size:13px}
      .password-row{display:flex;gap:8px}
      .password-row button{min-width:72px;border-radius:14px;border:1px solid var(--line);background:var(--bg);color:var(--text)}
      .error-box{margin:14px 0 0;padding:12px 14px;border-radius:14px;border:1px solid #d9d9d9;background:#fafafa;color:#333;line-height:1.6}
      .error-box.compact{margin:0;padding:10px 12px}
      .auth-note{margin-top:14px;font-size:12px;color:var(--faint);line-height:1.6}
      .text-link{width:100%;border:none;background:transparent;color:var(--muted);padding:0;margin-top:14px}
      .workspace{max-width:1440px;margin:0 auto;padding:18px 24px 0;display:grid;grid-template-columns:280px 1fr;gap:18px;min-height:calc(100vh - 98px)}
      .sidebar{overflow:hidden;display:flex;flex-direction:column}
      .sidebar.hidden{display:none}
      .sidebar-head{padding:14px 16px;border-bottom:1px solid var(--line);font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);font-weight:700}
      .file-list{overflow:auto;max-height:calc(100vh - 220px)}
      .file-row{width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;border:none;border-bottom:1px solid #f0f0f0;background:transparent;color:var(--text);text-align:left;border-radius:0}
      .file-row.active{background:var(--panel2)}
      .file-tag{width:54px;flex:0 0 54px;font-size:10px;letter-spacing:.16em;font-weight:700;color:var(--muted)}
      .file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
      .main-panel{overflow:hidden;display:flex;flex-direction:column;min-height:60vh}
      .panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--panel2)}
      .panel-file{font-weight:700}
      .panel-badges{display:flex;gap:8px;align-items:center}
      .badge{padding:7px 10px;border-radius:999px;border:1px solid var(--line);background:var(--bg);font-size:11px;color:var(--muted)}
      .badge.light{background:#fafafa}
      .code-block{margin:0;padding:20px;overflow:auto;flex:1;font-family:${CODE_FONT};font-size:12px;line-height:1.8;background:#fff;color:#111}
      .preview-shell{margin:0;overflow:hidden;flex:1;display:flex;flex-direction:column;border-radius:0;box-shadow:none}
      .browser-bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--line);background:#fafafa}
      .traffic{width:11px;height:11px;border-radius:50%}
      .traffic.red{background:#d0d0d0}
      .traffic.yellow{background:#b8b8b8}
      .traffic.green{background:#9c9c9c}
      .address-pill{margin-left:10px;height:24px;display:flex;align-items:center;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-size:11px;color:var(--muted)}
      iframe{width:100%;flex:1;border:none;background:#fff}
      .preview-overlay{position:fixed;inset:0;z-index:80;background:#fff;display:flex;flex-direction:column}
      .preview-overlay-head{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;border-bottom:1px solid var(--line);background:#fff}
      .preview-overlay-head div{display:grid;gap:2px;min-width:0}
      .preview-overlay-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .preview-overlay-head span{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .preview-overlay iframe{height:calc(100vh - 64px);flex:1}
      .setup-grid{padding:18px;display:grid;gap:18px}
      .setup-block{padding:20px}
      .setup-block h2{font-size:22px}
      .setup-list{display:grid;gap:10px}
      .setup-item{display:flex;gap:12px;align-items:flex-start}
      .setup-item code,.tree-box{display:block;width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:#fbfbfb;font-family:${CODE_FONT};font-size:12px;line-height:1.7;white-space:pre-wrap}
      .setup-step{width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:grid;place-items:center;background:#111;color:#fff;font-size:11px;font-weight:700}
      .setup-step.light{background:#f0f0f0;color:#111;border:1px solid var(--line)}
      .refine-bar{max-width:1440px;margin:0 auto;padding:14px 24px 26px}
      .refine-row{display:flex;gap:10px;align-items:center}
      .refine-row input{flex:1}
      .examples{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
      .example-chip{padding:10px 14px;border-radius:999px;background:#fafafa;font-size:12px}
      .row-between{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:14px}
      .hint{color:var(--muted);font-size:12px}
      kbd{display:inline-block;padding:1px 6px;border:1px solid var(--line);border-bottom-width:2px;border-radius:6px;background:#fff;font-family:${CODE_FONT};font-size:11px}
      .topbar-title{min-width:0;display:flex;flex-direction:column;gap:2px;margin-right:auto}
      .title-main{font-weight:700}
      .title-sub{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw}
      .root-frame{min-height:100vh;display:grid;place-items:center;position:relative;overflow:hidden}
      .stack{text-align:center;position:relative;z-index:1}
      .logo-wordmark{display:flex;align-items:center;justify-content:center;gap:12px;font-family:${SERIF_FONT};font-size:42px;letter-spacing:-.05em}
      .logo-kicker{margin-top:8px;font-size:11px;letter-spacing:.34em;text-transform:uppercase;color:var(--muted)}
      .logo-mark-inline{width:18px;height:18px;border:1px solid var(--text);border-radius:5px;position:relative;display:inline-block}
      .logo-mark-inline::before{content:"";position:absolute;left:8px;top:-1px;width:1px;height:20px;background:var(--text)}
      .logo-mark-inline::after{content:"";position:absolute;right:-6px;bottom:-6px;width:5px;height:5px;border-radius:50%;background:var(--text)}
      .ring{position:absolute;border-radius:50%;pointer-events:none;border:1px solid rgba(0,0,0,0.04)}
      .ring.one{width:720px;height:720px;top:-220px;left:-180px}
      .ring.two{width:540px;height:540px;right:-160px;bottom:-200px}
      @keyframes pulse{
        0%{box-shadow:0 0 0 0 rgba(0,0,0,.28)}
        70%{box-shadow:0 0 0 10px rgba(0,0,0,0)}
        100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}
      }
      @media (max-width: 960px){
        .auth-layout,.workspace{grid-template-columns:1fr}
        .topbar{padding:14px 16px}
        .workspace{padding:16px}
        .refine-bar{padding:14px 16px 24px}
        .plan-grid,.plan-columns{grid-template-columns:1fr}
      }
      @media (max-width: 720px){
        .topbar{gap:10px}
        .title-sub{max-width:100%}
        .page{padding:24px 16px 60px}
        .auth-layout{padding:16px}
        .hero-copy h1{font-size:clamp(34px,10vw,56px)}
        .builder-page{padding:18px 14px 56px}
        .builder-command{padding:18px;border-radius:14px}
        .row-between{align-items:stretch;flex-direction:column}
        .button-row{justify-content:stretch}
        .button-row button{width:100%}
        .panel-badges{flex-wrap:wrap;justify-content:flex-end}
        .preview-overlay-head{align-items:flex-start;flex-direction:column}
      }
    </style>
    ${state.screen === "auth" ? authView() : ""}
    ${state.screen === "dashboard" ? dashboardView() : ""}
    ${state.screen === "new" ? newProjectView() : ""}
    ${state.screen === "project" ? projectView() : ""}
    ${fullscreenPreviewView()}
  `;
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
  try {
    const user = await loadCurrentUser();
    if (user) {
      const projects = await listProjects(user.email);
      state.screen = "dashboard";
      setState({
        user,
        projects,
        currentProjectId: projects[0]?.id || null,
        currentTab: "code",
        booting: false,
        error: "",
      });
    } else {
      state.screen = "auth";
      setState({ booting: false });
    }
  } catch (error) {
    setState({ booting: false, error: error.message || String(error) });
  } finally {
    render();
  }
}

function parseJsonResponse(text) {
  const trimmed = String(text || "").trim();
  const cleaned = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Artemis could not read the AI response as project JSON. Try a shorter prompt or build from a plan first.");
  }
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
  return `You are refining an existing app.
Original brief: ${basePrompt}
Current files: ${currentFilesText}
Requested change: ${refinement}

Return the full updated project as strict JSON.`;
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
    max_tokens: 3200,
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
  const { name, email, password } = state.authForm;
  if (!email.trim() || !password.trim() || (state.authMode === "signup" && !name.trim())) {
    setState({ error: "Please fill in all required fields." });
    return;
  }

  setState({ busy: true, error: "" });
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (state.authMode === "signup") {
      const existing = await getUser(normalizedEmail);
      if (existing) throw new Error("An account with this email already exists.");
      const user = {
        email: normalizedEmail,
        name: name.trim(),
        passwordHash: await sha256(password),
        createdAt: nowIso(),
      };
      await saveUser(user);
      setSessionUserEmail(normalizedEmail);
      const projects = await listProjects(normalizedEmail);
      state.screen = "dashboard";
      setState({
        user,
        projects,
        currentProjectId: null,
        busy: false,
        authForm: { name: "", email: normalizedEmail, password: "" },
      });
      return;
    }

    const user = await getUser(normalizedEmail);
    if (!user) throw new Error("No account found for that email.");
    const hash = await sha256(password);
    if (hash !== user.passwordHash) throw new Error("Incorrect password.");
    setSessionUserEmail(normalizedEmail);
    const projects = await listProjects(normalizedEmail);
    state.screen = "dashboard";
    setState({
      user,
      projects,
      currentProjectId: projects[0]?.id || null,
      busy: false,
      authForm: { name: "", email: normalizedEmail, password: "" },
    });
  } catch (error) {
    setState({ busy: false, error: error.message || String(error) });
  }
}

async function createProject() {
  if (!state.newPrompt.trim() || state.busy) return;
  setState({ busy: true, error: "", buildStage: "Reading brief", buildDetails: [], lastPlan: state.lastPlan });
  try {
    await showBuildStage("Reading brief", "Extracting product goals, audience, and required screens.");
    await showBuildStage("Designing experience", "Choosing layout structure, responsive behavior, and motion moments.");
    await showBuildStage("Writing files", "Generating project files, preview HTML, setup notes, and UX rationale.");
    const result = await generateProject(state.newPrompt.trim());
    await showBuildStage("Saving project", "Storing the generated app in the local Artemis database.");
    const project = {
      id: uid(),
      ownerEmail: state.user.email,
      name: result.appName || "Untitled App",
      description: result.description || state.newPrompt.trim(),
      prompt: state.newPrompt.trim(),
      result,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await upsertProject(project);
    const projects = await listProjects(state.user.email);
    state.screen = "project";
    setState({
      projects,
      currentProjectId: project.id,
      currentTab: "code",
      selectedFileIndex: 0,
      newPrompt: "",
      refinePrompt: "",
      buildStage: "",
      buildDetails: [],
      lastPlan: null,
      busy: false,
    });
    notify("Project saved");
  } catch (error) {
    setState({ busy: false, buildStage: "", error: error.message || String(error) });
  }
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
  setState({ busy: true, error: "", buildStage: "Updating app", buildDetails: [] });
  try {
    await showBuildStage("Reading current app", "Reviewing the saved files and the requested refinement.");
    await showBuildStage("Applying improvement", "Regenerating the project with updated UI, preview, and notes.");
    const result = await generateProject(state.refinePrompt.trim(), project);
    const updated = {
      ...project,
      name: result.appName || project.name,
      description: result.description || project.description,
      result,
      updatedAt: nowIso(),
    };
    await upsertProject(updated);
    const projects = await listProjects(state.user.email);
    setState({
      projects,
      currentProjectId: updated.id,
      currentTab: "code",
      selectedFileIndex: 0,
      refinePrompt: "",
      buildStage: "",
      buildDetails: [],
      busy: false,
    });
    notify("Project updated");
  } catch (error) {
    setState({ busy: false, buildStage: "", error: error.message || String(error) });
  }
}

async function openProject(id) {
  state.screen = "project";
  setState({
    currentProjectId: id,
    currentTab: "code",
    selectedFileIndex: 0,
    error: "",
    notice: "",
  });
}

async function removeProject(id) {
  const project = state.projects.find((item) => item.id === id);
  if (!project) return;
  if (!confirm("Delete this project? This cannot be undone.")) return;
  await deleteProject(id);
  const projects = await listProjects(state.user.email);
  setState({
    projects,
    currentProjectId: projects[0]?.id || null,
    currentTab: "code",
    selectedFileIndex: 0,
  });
  notify("Project deleted");
  if (!projects.length) {
    state.screen = "dashboard";
    render();
  }
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
    setSessionUserEmail("");
    state.screen = "auth";
    state.user = null;
    state.projects = [];
    state.currentProjectId = null;
    state.authForm = { name: "", email: "", password: "" };
    state.newPrompt = "";
    state.refinePrompt = "";
    state.error = "";
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
