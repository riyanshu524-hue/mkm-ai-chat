const DEFAULT_MODEL = "llama3.2:3b"
const ALLOWED_MODELS = new Set (["llama3.2:3b", "llama3.2:1b", "qwen2.5:1.5b", "gemma2:2b"]);
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

  try {
    const { messages = [], attachments = [], model = DEFAULT_MODEL } = JSON.parse(event.body || "{}");
    const selectedModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const ollamaMessages = buildMessages(messages, attachments);

    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 1000
        }
      })
    });

    const data = await ollamaRes.json();
    if (!ollamaRes.ok) {
      return {
        statusCode: ollamaRes.status,
        headers: jsonHeaders,
        body: JSON.stringify({ error: data.error || "Ollama request failed" })
      };
    }

    const text = data.message?.content || "";
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
