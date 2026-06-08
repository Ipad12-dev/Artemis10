/**
 * api/preview.js - Handles preview-specific operations
 */

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      return res.status(200).json({
        status: "healthy",
        version: "2.0.0",
        features: [
          "multi-worker-compilation",
          "error-aggregation",
          "hot-reload",
          "health-monitoring",
        ],
      });
    }

    if (req.method === "POST") {
      const { action, payload } = req.body;

      if (action === "validate-project") {
        const { files } = payload;
        const validation = validateProjectStructure(files);
        return res.status(200).json(validation);
      }

      if (action === "analyze-dependencies") {
        const { files } = payload;
        const analysis = analyzeDependencies(files);
        return res.status(200).json(analysis);
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    return res.status(500).json({
      error: error.message,
      action: req.body?.action,
    });
  }
};

function validateProjectStructure(files = []) {
  const errors = [];
  const warnings = [];

  if (!files || files.length === 0) {
    errors.push("Project has no files");
    return { valid: false, errors, warnings };
  }

  const jsFiles = files.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f.path));
  const hasEntryPoint = jsFiles.some((f) =>
    /App|Home|LandingPage|Website|index/.test(f.path)
  );

  if (!hasEntryPoint) {
    warnings.push(
      "No entry point (App, Home, index, etc.) found. Preview may not render."
    );
  }

  const hasCss = files.some((f) => f.path.endsWith(".css"));
  if (!hasCss) {
    warnings.push("No CSS files found. Styling may be limited.");
  }

  for (const file of jsFiles) {
    if (file.content?.length > 500000) {
      warnings.push(
        `File ${file.path} is very large (${(file.content.length / 1000).toFixed(0)}KB). Preview may be slow.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fileCount: files.length,
    hasEntryPoint,
    hasCss,
  };
}

function analyzeDependencies(files = []) {
  const dependencies = new Map();
  const external = new Set();

  for (const file of files.filter((f) => /\.(js|jsx|ts|tsx)$/.test(f.path))) {
    const imports = extractImports(file.content);
    
    for (const imp of imports) {
      if (imp.startsWith(".")) {
        if (!dependencies.has(imp)) {
          dependencies.set(imp, []);
        }
        dependencies.get(imp).push(file.path);
      } else {
        external.add(imp);
      }
    }
  }

  return {
    totalDependencies: dependencies.size,
    externalPackages: Array.from(external),
    internalModules: Array.from(dependencies.keys()),
  };
}

function extractImports(code) {
  const imports = new Set();
  const importRegex =
    /(?:import|require)\s*\(?["'`]([^"'`]+)["'`]\)?/g;
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }

  return Array.from(imports);
}

module.exports.config = { maxDuration: 30 };
