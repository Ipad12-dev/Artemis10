module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const groqKey = process.env.GROQ_API_KEY;
  const grokKey = process.env.GROK_API_KEY;
  const apiKey = groqKey || grokKey;

  if (!apiKey) {
    return res.status(500).json({ error: "No API key found. Add GROQ_API_KEY or GROK_API_KEY in Vercel Settings → Environment Variables" });
  }

  const isGrok = !!grokKey && !groqKey;
  const endpoint = isGrok ? "https://api.x.ai/v1/chat/completions" : "https://api.groq.com/openai/v1/chat/completions";
  const defaultModel = isGrok ? "grok-3-mini-beta" : "openai/gpt-oss-20b";
  const model = isGrok
    ? process.env.GROK_MODEL || defaultModel
    : process.env.GROQ_MODEL || defaultModel;

  const { system, messages, max_tokens, response_format, temperature } = req.body;
  const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  const payload = {
    model,
    max_completion_tokens: max_tokens || 8192,
    temperature: typeof temperature === "number" ? temperature : 0.2,
    reasoning_effort: req.body.reasoning_effort || "low",
    messages: fullMessages,
  };

  if (response_format) {
    payload.response_format = response_format;
  }

  try {
    const sendRequest = (body) => fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });

    let response = await sendRequest(payload);
    let data = await response.json();

    const errorMessage = data.error?.message || "";
    const jsonModeFailed = response_format && /json|validate|schema|failed_generation/i.test(errorMessage);
    if (jsonModeFailed) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.response_format;
      fallbackPayload.messages = [
        ...fullMessages,
        {
          role: "user",
          content: "Your last response failed strict JSON validation. Return only one valid JSON object that matches the requested schema. Do not include markdown, commentary, or code fences.",
        },
      ];
      response = await sendRequest(fallbackPayload);
      data = await response.json();
    }

    if (data.error) {
      const message = data.error.message || JSON.stringify(data.error);
      const status = response.status === 429 ? 429 : 500;
      const friendly = response.status === 429
        ? `${message} Artemis is using the lighter Groq model now, but the free tier can still need a short cooldown. Try again in a few seconds.`
        : message;
      return res.status(status).json({ error: friendly });
    }

    const message = data.choices?.[0]?.message || {};
    const content = message.content;
    const text = Array.isArray(content)
      ? content.map((item) => item.text || item.content || "").join("")
      : content || data.output_text || data.choices?.[0]?.text || "";

    if (!String(text).trim()) {
      return res.status(500).json({
        error: "Groq returned an empty message. Artemis has lowered reasoning effort and completion settings; try again with a shorter prompt or use Plan first.",
        details: {
          model,
          finish_reason: data.choices?.[0]?.finish_reason || null,
          usage: data.usage || null,
        },
      });
    }

    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: "Request failed: " + err.message });
  }
};

module.exports.config = { maxDuration: 60 };
