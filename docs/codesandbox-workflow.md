# CodeSandbox Preview Workflow

Artemis can open CodeSandbox from the Preview tab in two ways:

1. Preferred: a GitHub-backed CodeSandbox project that uses this repository and branch.
2. Fallback: a one-off sandbox created from the generated files in the current Artemis project.

Use the GitHub-backed flow when you want changes made in CodeSandbox to sync back to the project.

## Configure The Repository Link

Edit `public/config.js`:

```js
window.ARTEMIS_CONFIG = {
  codesandbox: {
    githubRepo: "your-org/your-repo",
    branch: "main",
    file: "public/assets/index-DEWcOXYM.js",
    importBaseUrl: "https://codesandbox.io/p/github",
  },
};
```

`githubRepo` can also be a full GitHub URL. If it is empty, Artemis posts the generated files to the CodeSandbox define API instead. That is useful for quick previews, but it is not a durable sync path.

## Sync Changes Back

1. Push this project to GitHub.
2. Connect the repo in CodeSandbox and grant the GitHub permissions it asks for.
3. Click `Preview` and then `Open CodeSandbox` in Artemis.
4. In CodeSandbox, create or switch to a feature branch before editing.
5. Commit and push from CodeSandbox.
6. Pull the branch locally or open a pull request and merge it into `main`.

CodeSandbox's current repository flow is branch-based: every branch can have its own running environment, and repository imports are designed around GitHub-backed projects.

## Runtime And Environment

The repo includes `package.json` so CodeSandbox can run:

```sh
npm install
npm run dev
```

The dev command uses `vercel dev --listen 3000` so both `public/` and `api/chat.js` behave like the local/Vercel app.

Set these variables in CodeSandbox secrets or environment settings, not in committed files:

```sh
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
GROK_API_KEY=
GROK_MODEL=grok-3-mini-beta
```

`GROQ_API_KEY` is preferred. `GROK_API_KEY` is used only when `GROQ_API_KEY` is missing.
