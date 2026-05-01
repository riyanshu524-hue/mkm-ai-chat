const DEFAULT_MODEL = "llama-3.1-8b-instant"
const ALLOWED_MODELS = new Set (["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]);
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

  if (!process.env.GROQ_API_KEY) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: "Missing GROQ_API_KEY" }) };
  }

  try {
    const { messages = [], attachments = [], model = DEFAULT_MODEL } = JSON.parse(event.body || "{}");
    const selectedModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const openAiMessages = buildMessages(messages, attachments);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: openAiMessages,
        temperature: 0.7
      })
    });

    const data = await groqRes.json();
    if (!groqRes.ok) {
      return {
        statusCode: groqRes.status,
        headers: jsonHeaders,
        body: JSON.stringify({ error: data.error?.message || "Groq request failed" })
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
