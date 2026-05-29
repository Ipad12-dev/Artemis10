module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY — add it in Vercel Settings → Environment Variables" });
  }

  const { system, messages, max_tokens } = req.body;

  // Gemini uses OpenAI-compatible format
  const geminiMessages = system
    ? [{ role: "user", content: `SYSTEM INSTRUCTIONS:\n${system}\n\nNow respond to the following:` },
       { role: "model", content: "Understood. I will follow those instructions exactly." },
       ...messages]
    : messages;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: geminiMessages.map(m => ({
            role: m.role === "assistant" ? "model" : m.role === "model" ? "model" : "user",
            parts: [{ text: m.content }]
          })),
          generationConfig: {
            maxOutputTokens: max_tokens || 8192,
            temperature: 0.7
          }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: "Gemini error: " + (data.error.message || JSON.stringify(data.error)) });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(500).json({ error: "Empty response from Gemini. Try again." });
    }

    // Return in Anthropic format so frontend works unchanged
    return res.status(200).json({
      content: [{ type: "text", text }]
    });

  } catch (err) {
    return res.status(500).json({ error: "Request failed: " + err.message });
  }
};

module.exports.config = { maxDuration: 60 };
