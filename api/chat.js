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
  const defaultModel = isGrok ? "grok-3-mini-beta" : "openai/gpt-oss-120b";
  const model = isGrok
    ? process.env.GROK_MODEL || defaultModel
    : process.env.GROQ_MODEL || defaultModel;

  const { system, messages, max_tokens, response_format, temperature } = req.body;
  const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  const payload = {
    model,
    max_tokens: max_tokens || 8192,
    temperature: typeof temperature === "number" ? temperature : 0.2,
    messages: fullMessages,
  };

  if (response_format) {
    payload.response_format = response_format;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const text = data.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error: "Empty response. Try again." });

    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: "Request failed: " + err.message });
  }
};

module.exports.config = { maxDuration: 60 };
