const API_CHAT = "/api/chat";
const API_IMAGE = "/api/image";
const STORAGE_KEY = "mkm_chats_v1";
const MODEL_KEY = "mkm_model_v1";
const AUTO_SPEAK_KEY = "mkm_auto_speak_v1";

const el = {
  sidebar: document.getElementById("sidebar"),
  menuBtn: document.getElementById("menu-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  chatList: document.getElementById("chat-list"),
  chatWindow: document.getElementById("chat-window"),
  input: document.getElementById("prompt-input"),
  modelSelect: document.getElementById("model-select"),
  autoSpeakToggle: document.getElementById("auto-speak-toggle"),
  sendBtn: document.getElementById("send-btn"),
  imageBtn: document.getElementById("image-btn"),
  micBtn: document.getElementById("mic-btn"),
  attachBtn: document.getElementById("attach-btn"),
  fileInput: document.getElementById("file-input"),
  uploadPreview: document.getElementById("upload-preview"),
  msgTemplate: document.getElementById("msg-template")
};

const state = {
  chats: loadChats(),
  activeChatId: null,
  pendingFiles: [],
  generatingImage: false,
  model: loadModel(),
  autoSpeak: loadAutoSpeak()
};

init();

function init() {
  if (!state.chats.length) createChat("New chat");
  state.activeChatId = state.chats[0].id;
  renderChatList();
  renderMessages();
  bindEvents();
  el.modelSelect.value = state.model;
  el.autoSpeakToggle.checked = state.autoSpeak;
  registerServiceWorker();
}

function bindEvents() {
  el.menuBtn.addEventListener("click", () => {
    el.sidebar.classList.toggle("open");
  });

  el.newChatBtn.addEventListener("click", () => {
    createChat("New chat");
    renderChatList();
    renderMessages();
  });

  el.sendBtn.addEventListener("click", () => sendPrompt());
  el.imageBtn.addEventListener("click", () => sendPrompt({ imageMode: true }));
  el.modelSelect.addEventListener("change", () => {
    state.model = el.modelSelect.value;
    persistModel();
  });
  el.autoSpeakToggle.addEventListener("change", () => {
    state.autoSpeak = el.autoSpeakToggle.checked;
    persistAutoSpeak();
  });

  el.input.addEventListener("input", autoGrowInput);
  el.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  });

  el.attachBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    state.pendingFiles = await Promise.all(files.map(toUploadPayload));
    renderPendingFiles();
    el.fileInput.value = "";
  });

  setupSpeechInput();
}

function createChat(title) {
  const chat = {
    id: crypto.randomUUID(),
    title,
    messages: []
  };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  persist();
}

function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId);
}

function renderChatList() {
  el.chatList.innerHTML = "";
  for (const chat of state.chats) {
    const btn = document.createElement("button");
    btn.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;
    btn.textContent = chat.title || "Untitled chat";
    btn.addEventListener("click", () => {
      state.activeChatId = chat.id;
      renderChatList();
      renderMessages();
      el.sidebar.classList.remove("open");
    });
    el.chatList.appendChild(btn);
  }
}

function renderMessages() {
  const chat = getActiveChat();
  el.chatWindow.innerHTML = "";
  for (const msg of chat.messages) appendMessage(msg);
  scrollToBottom();
}

function appendMessage(message) {
  const frag = el.msgTemplate.content.cloneNode(true);
  const row = frag.querySelector(".bubble-row");
  const avatar = frag.querySelector(".avatar");
  const bubble = frag.querySelector(".bubble");

  const isUser = message.role === "user";
  row.classList.toggle("user", isUser);
  avatar.textContent = isUser ? "U" : "AI";

  if (message.type === "image" && message.imageUrl) {
    bubble.innerHTML = `<img class="msg-image" src="${message.imageUrl}" alt="Generated image" />`;
  } else {
    bubble.textContent = message.content || "";
  }

  if (!isUser && message.type !== "image" && message.content) {
    const ttsBtn = document.createElement("button");
    ttsBtn.className = "ghost-btn tts-btn";
    ttsBtn.textContent = "Speak";
    ttsBtn.addEventListener("click", () => speakText(message.content));
    bubble.appendChild(document.createElement("br"));
    bubble.appendChild(ttsBtn);
  }

  el.chatWindow.appendChild(frag);
}

async function sendPrompt(options = {}) {
  const imageMode = options.imageMode || false;
  if (state.generatingImage) return;

  const content = el.input.value.trim();
  if (!content && !state.pendingFiles.length) return;

  const chat = getActiveChat();
  const userMessage = {
    role: "user",
    type: "text",
    content
  };
  chat.messages.push(userMessage);
  appendMessage(userMessage);

  if (chat.messages.length === 1 && content) {
    chat.title = content.slice(0, 24);
    renderChatList();
  }

  const files = [...state.pendingFiles];
  state.pendingFiles = [];
  renderPendingFiles();

  el.input.value = "";
  autoGrowInput();

  const loading = addLoadingBubble(imageMode ? "Generating image..." : "Thinking...");
  persist();

  try {
    if (imageMode) {
      state.generatingImage = true;
      const imageUrl = await generateImage(content);
      loading.remove();
      const imageMsg = { role: "assistant", type: "image", imageUrl, content: "Generated image" };
      chat.messages.push(imageMsg);
      appendMessage(imageMsg);
      persist();
      return;
    }

    const text = await askAI(chat.messages, files, state.model);
    loading.remove();
    await appendTypingAssistant(text, chat);
  } catch (error) {
    loading.remove();
    const msg = { role: "assistant", type: "text", content: `Error: ${error.message}` };
    chat.messages.push(msg);
    appendMessage(msg);
    persist();
  } finally {
    state.generatingImage = false;
  }
}

async function askAI(messages, files, model) {
  const response = await fetch(API_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.slice(-14),
      attachments: files
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Chat API failed");
  return data.text || "No response.";
}

async function generateImage(prompt) {
  const response = await fetch(API_IMAGE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Image API failed");
  return data.image;
}

function addLoadingBubble(label) {
  const row = document.createElement("article");
  row.className = "bubble-row";
  row.innerHTML = `<div class="avatar">AI</div><div class="bubble typing">${label}</div>`;
  el.chatWindow.appendChild(row);
  scrollToBottom();
  return row;
}

async function appendTypingAssistant(text, chat) {
  const row = document.createElement("article");
  row.className = "bubble-row";
  row.innerHTML = `<div class="avatar">AI</div><div class="bubble typing"></div>`;
  const bubble = row.querySelector(".bubble");
  el.chatWindow.appendChild(row);

  let out = "";
  for (const ch of text) {
    out += ch;
    bubble.textContent = out;
    scrollToBottom();
    await wait(8);
  }
  bubble.classList.remove("typing");

  const ttsBtn = document.createElement("button");
  ttsBtn.className = "ghost-btn tts-btn";
  ttsBtn.textContent = "Speak";
  ttsBtn.addEventListener("click", () => speakText(text));
  bubble.appendChild(document.createElement("br"));
  bubble.appendChild(ttsBtn);

  chat.messages.push({ role: "assistant", type: "text", content: text });
  persist();
  if (state.autoSpeak) speakText(text);
}

function autoGrowInput() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 140)}px`;
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1;
  speechSynthesis.speak(u);
}

function setupSpeechInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    el.micBtn.disabled = true;
    el.micBtn.title = "Speech recognition not supported";
    return;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  el.micBtn.addEventListener("click", () => rec.start());
  rec.addEventListener("result", (event) => {
    const text = event.results[0][0].transcript || "";
    el.input.value = `${el.input.value} ${text}`.trim();
    autoGrowInput();
  });
}

async function toUploadPayload(file) {
  const base = {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size
  };
  if (file.type.startsWith("image/")) {
    base.dataUrl = await readAsDataURL(file);
  } else if (
    file.type.startsWith("text/") ||
    /\.txt|\.md|\.json|\.csv$/i.test(file.name)
  ) {
    base.text = await file.text();
  } else {
    base.note = "Binary file attached. AI sees file metadata if content extraction is unavailable.";
  }
  return base;
}

function renderPendingFiles() {
  const hasFiles = state.pendingFiles.length > 0;
  el.uploadPreview.classList.toggle("hidden", !hasFiles);
  if (!hasFiles) {
    el.uploadPreview.innerHTML = "";
    return;
  }
  el.uploadPreview.innerHTML = state.pendingFiles
    .map((f) => `<span class="file-chip">${f.name}</span>`)
    .join("");
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.chats));
}

function loadChats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistModel() {
  localStorage.setItem(MODEL_KEY, state.model);
}

function loadModel() {
  const saved = localStorage.getItem(MODEL_KEY);
  return saved === "llama3.2:3b" ? "llama3.2:3b" : "llama3.2:1b";
}

function persistAutoSpeak() {
  localStorage.setItem(AUTO_SPEAK_KEY, state.autoSpeak ? "1" : "0");
}

function loadAutoSpeak() {
  const saved = localStorage.getItem(AUTO_SPEAK_KEY);
  return saved !== "0";
}

function scrollToBottom() {
  el.chatWindow.scrollTop = el.chatWindow.scrollHeight;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("/service-worker.js");
    } catch {
      // Ignore registration failures in unsupported contexts.
    }
  }
}
