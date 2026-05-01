const DEFAULT_MODEL = "openai/gpt-3.5-turbo"
const ALLOWED_MODELS = new Set (["openai/gpt-3.5-turbo", "meta-llama/llama-3.1-8b-instruct", "anthropic/claude-3-haiku"]);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...jsonHeaders,
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: "Missing OPENROUTER_API_KEY" }) };
  }

  try {
    const { messages = [], attachments = [], model = DEFAULT_MODEL } = JSON.parse(event.body || "{}");
    const selectedModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const openrouterMessages = buildMessages(messages, attachments);

    const openrouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://mkm-ai-chat.netlify.app",
        "X-Title": "MKM AI Chat"
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: openrouterMessages,
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await openrouterRes.json();
    if (!openrouterRes.ok) {
      return {
        statusCode: openrouterRes.status,
        headers: jsonHeaders,
        body: JSON.stringify({ error: data.error?.message || "OpenRouter request failed" })
      };
    }

    const text = data.choices?.[0]?.message?.content || "";
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ text }) };
  } catch (error) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: error.message }) };
  }
};

function buildMessages(messages, attachments) {
  const mapped = messages.map((m) => ({ role: m.role, content: m.content || "" }));
  if (!attachments?.length) return mapped;

  const attachmentNotes = attachments.map((file) => {
    if (file.dataUrl && file.type?.startsWith("image/")) {
      return {
        type: "image_url",
        image_url: { url: file.dataUrl }
      };
    }
    const textSnippet = file.text ? `\nExtracted text:\n${String(file.text).slice(0, 9000)}` : "";
    return {
      type: "text",
      text: `File attached: ${file.name} (${file.type}, ${file.size} bytes).${textSnippet}`
    };
  });

  const lastUserIdx = [...mapped].map((m) => m.role).lastIndexOf("user");
  if (lastUserIdx === -1) return mapped;

  const textContent = mapped[lastUserIdx].content || "Analyze attached files.";
  mapped[lastUserIdx] = {
    role: "user",
    content: [
      { type: "text", text: textContent },
      ...attachmentNotes
    ]
  };
  return mapped;
}
