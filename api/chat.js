module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENROUTER_API_KEY in Vercel environment variables" });
  }

  const models = [
    "qwen/qwen3-coder:free",
    "deepseek/deepseek-v4-flash:free",
    "qwen/qwen3-235b-a22b:free",
    "meta-llama/llama-4-maverick:free",
    "deepseek/deepseek-chat-v3.1:free",
    "meta-llama/llama-3.3-70b-instruct:free"
  ];

  const { system, messages, max_tokens } = req.body;
  const orMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  let lastError = "";

  for (const model of models) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://artemis10.vercel.app",
          "X-Title": "Artemis AI Builder"
        },
        body: JSON.stringify({
          model,
          max_tokens: max_tokens || 4000,
          messages: orMessages
        })
      });

      const data = await response.json();

      if (data.error) {
        lastError = `${model}: ${data.error.message || JSON.stringify(data.error)}`;
        continue;
      }

      if (!data.choices?.[0]?.message?.content) {
        lastError = `${model}: empty response`;
        continue;
      }

      return res.status(200).json({
        content: [{ type: "text", text: data.choices[0].message.content }]
      });

    } catch (err) {
      lastError = `${model}: ${err.message}`;
      continue;
    }
  }

  return res.status(500).json({
    error: `All models failed. Last error: ${lastError}`
  });
};

// Tell Vercel to allow up to 60 seconds (fixes the 10s timeout issue)
module.exports.config = { maxDuration: 60 };
