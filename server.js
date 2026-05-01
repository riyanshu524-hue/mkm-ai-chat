const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = "qwen2.5:1.5b";
const ALLOWED_MODELS = new Set(["qwen2.5:1.5b", "qwen2.5:0.5b", "llama3.2:3b", "llama3.1:8b", "gemma2:9b"]);
const OLLAMA_BASE_URL = "http://localhost:11434";

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

const server = http.createServer(async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // Handle API routes
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { messages = [], attachments = [], model = DEFAULT_MODEL } = JSON.parse(body);
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
                temperature: 0.1,
                top_p: 0.5,
                max_tokens: 200,
                num_ctx: 1024,
                num_batch: 256,
                repeat_penalty: 1.05,
                num_predict: 150,
                use_mmap: true,
                use_mlock: false,
                embedding_only: false,
                rope_scaling: { factor: 1.0, type: "yarn" },
                low_vram: true
              }
            })
          });

          const data = await ollamaRes.json();
          if (!ollamaRes.ok) {
            res.writeHead(ollamaRes.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: data.error || "Ollama request failed" }));
            return;
          }

          const text = data.message?.content || "";
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Handle image generation (placeholder)
  if (url.pathname === '/api/image' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" 
    }));
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, url.pathname);
  if (filePath === path.join(__dirname, '/')) {
    filePath = path.join(__dirname, 'index.html');
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content, 'utf-8');
    }
  });
});

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

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Make sure Ollama is running on ${OLLAMA_BASE_URL}`);
});
