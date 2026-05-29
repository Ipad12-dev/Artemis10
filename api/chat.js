module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });
  }

  const models = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free"
  ];

  const { system, messages, max_tokens } = req.body;
  const orMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

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
          max_tokens: max_tokens || 8000,
          messages: orMessages
        })
      });

      const data = await response.json();

      if (data.error || !data.choices || !data.choices[0]) continue;

      return res.status(200).json({
        content: [{ type: "text", text: data.choices[0].message.content }]
      });

    } catch (err) {
      continue;
    }
  }

  return res.status(500).json({ error: "All free models failed. Please try again in a moment." });
};
