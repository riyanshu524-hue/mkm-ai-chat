const DEFAULT_MODEL = "gemini-1.5-flash"
const ALLOWED_MODELS = new Set (["gemini-1.5-flash", "gemini-1.5-pro"]);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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

  if (!process.env.GEMINI_API_KEY) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
  }

  try {
    const { messages = [], attachments = [], model = DEFAULT_MODEL } = JSON.parse(event.body || "{}");
    const selectedModel = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    const geminiMessages = buildMessages(messages, attachments);

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
          topP: 0.8,
          topK: 40
        }
      })
    });

    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      return {
        statusCode: geminiRes.status,
        headers: jsonHeaders,
        body: JSON.stringify({ error: data.error?.message || "Gemini request failed" })
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ text }) };
  } catch (error) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: error.message }) };
  }
};

function buildMessages(messages, attachments) {
  const geminiMessages = [];
  
  // Convert OpenAI format to Gemini format
  for (const message of messages) {
    if (message.role === 'user') {
      let content = message.content || "";
      
      // Handle attachments
      if (attachments?.length) {
        const attachmentNotes = attachments.map((file) => {
          if (file.dataUrl && file.type?.startsWith("image/")) {
            return {
              inline_data: {
                mime_type: file.type,
                data: file.dataUrl.split(',')[1]
              }
            };
          }
          const textSnippet = file.text ? `\nExtracted text:\n${String(file.text).slice(0, 9000)}` : "";
          return `File attached: ${file.name} (${file.type}, ${file.size} bytes).${textSnippet}`;
        });
        
        // Build Gemini content parts
        const parts = [{ text: content }];
        attachmentNotes.forEach(note => {
          if (typeof note === 'object' && note.inline_data) {
            parts.push(note);
          } else {
            parts.push({ text: note });
          }
        });
        
        geminiMessages.push({ role: "user", parts });
      } else {
        geminiMessages.push({ role: "user", parts: [{ text: content }] });
      }
    }
  }
  
  return geminiMessages;
}
