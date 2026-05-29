// api/chat.js — OpenRouter proxy (free tier)
// Get your free API key at https://openrouter.ai/keys

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing OPENROUTER_API_KEY — add it in Vercel → Settings → Environment Variables"
    });
  }

  try {
    // Convert Anthropic-style request → OpenRouter format
    const { system, messages, max_tokens } = req.body;
    const orMessages = system
      ? [{ role: "system", content: system }, ...messages]
      : messages;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://artemis10.vercel.app",
        "X-Title": "Artemis AI Builder"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free",
        max_tokens: max_tokens || 8000,
        messages: orMessages
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
    }

    // Convert OpenRouter response back to Anthropic format so frontend works unchanged
    if (data.choices && data.choices[0]) {
      return res.status(200).json({
        content: [{ type: "text", text: data.choices[0].message.content }]
      });
    }

    return res.status(500).json({ error: "Unexpected response from OpenRouter: " + JSON.stringify(data) });
  } catch (err) {
    return res.status(500).json({ error: "Proxy error: " + err.message });
  }
};
