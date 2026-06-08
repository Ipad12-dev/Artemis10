/**
 * api/chat.js  –  Artemis AI proxy  (Phase 4 stabilised)
 *
 * Fixes applied vs original:
 *   B1  – Default Groq model changed from invalid "openai/gpt-oss-20b" to
 *          "llama-3.3-70b-versatile" (highest-quality native Groq model)
 *   B2  – Exponential back-off retry loop (3 attempts, jittered delay)
 *   B4  – reasoning_effort stripped before sending to Groq (Grok-only param)
 *   B5  – max_completion_tokens → max_tokens for Groq compatibility
 *   B6  – CORS restricted to same origin in production; wildcard only when
 *          ARTEMIS_ALLOW_ALL_ORIGINS=true env var is set (dev convenience)
 *   B7  – Full request-body validation with clear 400 responses
 *   B8  – JSON-mode retry uses corrected payload (no Grok-only params for Groq)
 */

const MAX_RETRIES   = 3;       // total attempts (1 original + 2 retries)
const BASE_DELAY_MS = 800;     // starting back-off (doubles each retry + jitter)

/** Jittered exponential back-off delay */
function backoffDelay(attempt) {
  const exp   = BASE_DELAY_MS * Math.pow(2, attempt);   // 800 / 1600 / 3200
  const jitter = Math.random() * 400;                    // 0–400 ms noise
  return new Promise(r => setTimeout(r, exp + jitter));
}

/** Classify an HTTP status as retryable */
function isRetryable(status) {
  return status === 429 || status === 500 || status === 502 ||
         status === 503 || status === 504;
}

/** Build a user-facing error message for a given HTTP status */
function friendlyError(status, rawMessage, provider) {
  if (status === 429) {
    return (
      `${provider} rate limit reached. Artemis will retry automatically — ` +
      `if this keeps happening, wait 15 seconds and try a shorter prompt, ` +
      `or switch to a different model via the GROQ_MODEL environment variable.\n\n` +
      `Provider detail: ${rawMessage}`
    );
  }
  if (status === 401 || status === 403) {
    return `API key rejected by ${provider} (${status}). ` +
           `Check your GROQ_API_KEY / GROK_API_KEY in Vercel → Settings → Environment Variables.`;
  }
  if (status >= 500) {
    return `${provider} server error (${status}) — retrying… ${rawMessage}`;
  }
  return rawMessage || `Unexpected ${provider} error (${status})`;
}

module.exports = async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────
  const allowAllOrigins = process.env.ARTEMIS_ALLOW_ALL_ORIGINS === 'true';
  const origin = req.headers['origin'] || '';
  if (allowAllOrigins) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    // Only allow same-origin requests in production
    const host = req.headers['host'] || '';
    if (origin && origin.includes(host.split(':')[0])) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── API key resolution ───────────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  const grokKey = process.env.GROK_API_KEY;
  const apiKey  = groqKey || grokKey;

  if (!apiKey) {
    return res.status(500).json({
      error:
        'No API key configured. Add GROQ_API_KEY or GROK_API_KEY in ' +
        'Vercel → Project Settings → Environment Variables, then redeploy.',
    });
  }

  const isGrok     = !!grokKey && !groqKey;
  const provider   = isGrok ? 'Grok (xAI)' : 'Groq';
  const endpoint   = isGrok
    ? 'https://api.x.ai/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';

  // B1 – use a valid, high-capacity native Groq model as default
  const defaultModel = isGrok ? 'grok-3-mini-beta' : 'llama-3.3-70b-versatile';
  const model = isGrok
    ? (process.env.GROK_MODEL  || defaultModel)
    : (process.env.GROQ_MODEL  || defaultModel);

  // ── Request body validation (B7) ─────────────────────────────────────────
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array.' });
  }
  // Validate each message has role + content
  for (const msg of body.messages) {
    if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      return res.status(400).json({
        error: 'Each message must have string "role" and "content" fields.',
      });
    }
  }

  const { system, messages, max_tokens, response_format, temperature } = body;
  const fullMessages = system
    ? [{ role: 'system', content: String(system) }, ...messages]
    : messages;

  // ── Build provider payload ────────────────────────────────────────────────
  // B5 – use max_tokens (Groq's param name) not max_completion_tokens
  // B4 – only forward reasoning_effort for Grok
  const payload = {
    model,
    max_tokens: typeof max_tokens === 'number' ? max_tokens : 8192,
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    messages: fullMessages,
  };

  if (isGrok && body.reasoning_effort) {
    payload.reasoning_effort = body.reasoning_effort;
  }

  if (response_format && typeof response_format === 'object') {
    payload.response_format = response_format;
  }

  // ── Helper: single HTTP attempt ───────────────────────────────────────────
  async function attempt(pl) {
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(pl),
    });
    const data = await resp.json();
    return { resp, data };
  }

  // ── Retry loop with exponential back-off (B2) ─────────────────────────────
  let lastError = null;
  let lastStatus = 500;

  for (let attempt_n = 0; attempt_n < MAX_RETRIES; attempt_n++) {
    if (attempt_n > 0) {
      // Log the retry so operators can see it in Vercel Function Logs
      console.warn(
        `[artemis/chat] retry ${attempt_n}/${MAX_RETRIES - 1} ` +
        `after ${lastStatus} for model ${model}`
      );
      await backoffDelay(attempt_n - 1);
    }

    let resp, data;
    try {
      ({ resp, data } = await attempt(payload));
    } catch (netErr) {
      // Network-level error (DNS failure, timeout, etc.)
      lastError = `Network error contacting ${provider}: ${netErr.message}`;
      lastStatus = 503;
      if (attempt_n < MAX_RETRIES - 1) continue;
      break;
    }

    lastStatus = resp.status;

    // ── JSON-mode failure → retry without response_format (B8) ───────────
    if (response_format) {
      const errMsg = data?.error?.message || '';
      const jsonModeFailed =
        /json|validate|schema|failed_generation/i.test(errMsg);
      if (jsonModeFailed && attempt_n < MAX_RETRIES - 1) {
        console.warn('[artemis/chat] JSON-mode failed, retrying without response_format');
        const fallbackPayload = { ...payload };
        delete fallbackPayload.response_format;
        fallbackPayload.messages = [
          ...fullMessages,
          {
            role: 'user',
            content:
              'Your last response failed strict JSON validation. ' +
              'Return only one valid JSON object matching the requested schema. ' +
              'Do not include markdown, commentary, or code fences.',
          },
        ];
        try {
          ({ resp, data } = await attempt(fallbackPayload));
          lastStatus = resp.status;
        } catch (netErr) {
          lastError = `Network error on JSON-mode retry: ${netErr.message}`;
          continue;
        }
      }
    }

    // ── Provider-level error in body ─────────────────────────────────────
    if (data?.error) {
      const rawMsg = data.error.message || JSON.stringify(data.error);
      lastError = friendlyError(resp.status, rawMsg, provider);

      if (isRetryable(resp.status) && attempt_n < MAX_RETRIES - 1) {
        continue; // back off and retry
      }
      // Non-retryable or exhausted retries
      return res.status(resp.status === 429 ? 429 : 500).json({
        error: lastError,
      });
    }

    // ── Successful response ───────────────────────────────────────────────
    if (resp.ok) {
      const message = data.choices?.[0]?.message || {};
      const content = message.content;
      const text = Array.isArray(content)
        ? content.map(item => item.text || item.content || '').join('')
        : (content || data.output_text || data.choices?.[0]?.text || '');

      if (!String(text).trim()) {
        const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
        return res.status(500).json({
          error:
            `${provider} returned an empty response (finish_reason: ${finishReason}). ` +
            `This usually means the prompt is too long or the model hit its token limit. ` +
            `Try a shorter or simpler prompt, or use "Plan first" mode.`,
          details: {
            model,
            finish_reason: finishReason,
            usage: data.usage || null,
          },
        });
      }

      // Log token usage for operator visibility
      if (data.usage) {
        console.log(
          `[artemis/chat] ok | model=${model} ` +
          `prompt_tokens=${data.usage.prompt_tokens} ` +
          `completion_tokens=${data.usage.completion_tokens}`
        );
      }

      return res.status(200).json({ content: [{ type: 'text', text }] });
    }

    // Non-OK, non-error-in-body status (e.g. 400 Bad Request)
    lastError = friendlyError(
      resp.status,
      data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200),
      provider
    );

    if (!isRetryable(resp.status)) {
      return res.status(resp.status < 500 ? resp.status : 500).json({
        error: lastError,
      });
    }
  }

  // All retries exhausted
  return res.status(lastStatus === 429 ? 429 : 500).json({
    error:
      lastError ||
      `${provider} did not respond after ${MAX_RETRIES} attempts. ` +
      `Please wait a moment and try again.`,
  });
};

module.exports.config = { maxDuration: 60 };
