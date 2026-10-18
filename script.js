const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const $ = (id) => document.getElementById(id);

let apiKey = ""; // In-memory only; do not hardcode a real key here.
let modelName = "gemini-flash-latest";
let chats = [];
let activeChatId = null;
let isSending = false;
let abortController = null;

const messagesEl = $("messages");
const inputEl = $("messageInput");
const welcomeEl = $("welcome");
const settingsDialog = $("settingsDialog");

function makeChat() {
  return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), title: "New conversation", messages: [], updatedAt: Date.now() };
}
function saveChats() {
  try { localStorage.setItem("nova-gemini-chats-v1", JSON.stringify(chats)); }
  catch { /* Storage may be disabled or full. */ }
}
function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem("nova-gemini-chats-v1") || "[]");
    if (Array.isArray(saved)) chats = saved.filter(c => c && c.id && Array.isArray(c.messages));
  } catch { chats = []; }
  if (!chats.length) { const chat = makeChat(); chats = [chat]; activeChatId = chat.id; }
  else activeChatId = [...chats].sort((a,b) => b.updatedAt - a.updatedAt)[0].id;
  renderHistory(); renderChat();
}
function activeChat() { return chats.find(c => c.id === activeChatId); }
function newConversation() {
  const chat = makeChat(); chats.unshift(chat); activeChatId = chat.id;
  saveChats(); renderHistory(); renderChat(); inputEl.focus(); closeSidebar();
}
function renderHistory() {
  const list = $("historyList"); list.replaceChildren();
  [...chats].sort((a,b) => b.updatedAt - a.updatedAt).forEach(chat => {
    const btn = document.createElement("button");
    btn.className = "history-item" + (chat.id === activeChatId ? " active" : "");
    btn.textContent = chat.title || "New conversation"; btn.title = btn.textContent;
    btn.addEventListener("click", () => { activeChatId = chat.id; renderHistory(); renderChat(); closeSidebar(); });
    list.appendChild(btn);
  });
}
function renderChat() {
  messagesEl.replaceChildren();
  const chat = activeChat();
  const hasMessages = chat && chat.messages.length;
  welcomeEl.hidden = !!hasMessages;
  messagesEl.hidden = !hasMessages;
  if (!chat) return;
  chat.messages.forEach((msg, index) => addMessageToDOM(msg.role, msg.text, index));
  scrollToBottom();
}
function addMessageToDOM(role, text, index, options = {}) {
  const article = document.createElement("article");
  article.className = "message " + (role === "user" ? "user" : "assistant");
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = role === "user" ? "◉" : "✦";
  const body = document.createElement("div"); body.className = "message-body";
  const label = document.createElement("div"); label.className = "message-label"; label.textContent = role === "user" ? "You" : "Nova";
  const content = document.createElement("div"); content.className = "message-text"; content.textContent = text;
  body.append(label, content);
  if (role !== "user" && !options.typing) {
    const actions = document.createElement("div"); actions.className = "message-actions";
    const copy = document.createElement("button"); copy.className = "message-action"; copy.textContent = "▢ Copy";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = "✓ Copied"; }
      catch { copy.textContent = "Select text to copy"; }
      setTimeout(() => copy.textContent = "▢ Copy", 1500);
    });
    actions.append(copy); body.append(actions);
  }
  if (options.typing) {
    content.className = "typing-dots"; content.setAttribute("aria-label", "Nova is thinking");
    for (let i=0;i<3;i++) content.appendChild(document.createElement("i"));
    article.dataset.typing = "true";
  }
  article.append(avatar, body); messagesEl.appendChild(article); return article;
}
function scrollToBottom() { $("chatScroll").scrollTop = $("chatScroll").scrollHeight; }
function setBusy(busy) {
  isSending = busy; $("sendBtn").disabled = busy; $("sendBtn").querySelector("span").textContent = busy ? "Thinking" : "Send";
  $("sendBtn").querySelector("b").textContent = busy ? "…" : "↑";
}
function friendlyError(status, message) {
  if (status === 400) return "The request was rejected. Check your model name and message, then try again.";
  if (status === 401 || status === 403) return "The API key was rejected or does not have permission. Open API settings and check your replacement key and Gemini API access.";
  if (status === 404) return "That model was not found or is unavailable to your API key. Check the model name in API settings.";
  if (status === 429) return "The API rate limit or quota has been reached. Please wait and check your Gemini API usage limits.";
  if (status >= 500) return "The Gemini service is temporarily unavailable. Please try again shortly.";
  return message || "Something went wrong. Please try again.";
}
async function sendMessage(prefill) {
  if (isSending) return;
  const prompt = (typeof prefill === "string" ? prefill : inputEl.value).trim();
  if (!prompt) return;
  if (!apiKey) {
    settingsDialog.showModal();
    $("settingsStatus").textContent = "Add your replacement API key to start chatting.";
    return;
  }
  const chat = activeChat();
  if (!chat) return;
  inputEl.value = ""; resizeInput();
  chat.messages.push({ role: "user", text: prompt });
  if (chat.messages.filter(m => m.role === "user").length === 1) chat.title = prompt.slice(0, 36) + (prompt.length > 36 ? "…" : "");
  chat.updatedAt = Date.now(); saveChats(); renderHistory();
  welcomeEl.hidden = true; messagesEl.hidden = false;
  addMessageToDOM("user", prompt);
  const typing = addMessageToDOM("assistant", "", -1, { typing: true });
  setBusy(true); scrollToBottom();
  abortController = new AbortController();
  try {
    const contents = chat.messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }]
    }));
    const response = await fetch(`${API_BASE}${encodeURIComponent(modelName)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: "You are Nova, a helpful, clear, friendly AI assistant. Give accurate, structured answers. If you are unsure, say so. Use plain text and readable line breaks." }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      }),
      signal: abortController.signal
    });
    const data = await response.json().catch(() => ({}));
    typing.remove();
    if (!response.ok) throw new Error(friendlyError(response.status, data?.error?.message));
    const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
    if (!answer) throw new Error(data?.promptFeedback?.blockReason ? "Gemini could not answer this prompt because it was blocked by safety settings." : "Gemini returned an empty response. Please try rephrasing your message.");
    chat.messages.push({ role: "assistant", text: answer });
    chat.updatedAt = Date.now(); saveChats();
    addMessageToDOM("assistant", answer);
  } catch (error) {
    typing.remove();
    if (error.name !== "AbortError") addMessageToDOM("assistant", "⚠ " + (error.message || "Request failed. Check your connection and try again."));
  } finally {
    setBusy(false); abortController = null; scrollToBottom(); renderHistory(); inputEl.focus();
  }
}
function resizeInput() { inputEl.style.height = "auto"; inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + "px"; }
function closeSidebar() { $("sidebar").classList.remove("open"); }
function clearCurrentChat() {
  const chat = activeChat(); if (!chat) return;
  if (!chat.messages.length || confirm("Clear all messages in this conversation?")) {
    chat.messages = []; chat.title = "New conversation"; chat.updatedAt = Date.now();
    saveChats(); renderHistory(); renderChat();
  }
}
function exportChat() {
  const chat = activeChat(); if (!chat || !chat.messages.length) { alert("There are no messages to export yet."); return; }
  const content = `Nova AI conversation — ${chat.title}\nExported: ${new Date().toLocaleString()}\n\n` +
    chat.messages.map(m => `${m.role === "user" ? "You" : "Nova"}:\n${m.text}`).join("\n\n--------------------\n\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "nova-conversation.txt"; a.click(); URL.revokeObjectURL(url);
}
$("sendBtn").addEventListener("click", () => sendMessage());
inputEl.addEventListener("input", resizeInput);
inputEl.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$("newChatBtn").addEventListener("click", newConversation);
$("clearBtn").addEventListener("click", clearCurrentChat);
$("exportBtn").addEventListener("click", exportChat);
$("settingsBtn").addEventListener("click", () => { $("apiKeyInput").value = ""; $("modelInput").value = modelName; $("settingsStatus").textContent = ""; settingsDialog.showModal(); });
$("saveSettingsBtn").addEventListener("click", () => {
  const entered = $("apiKeyInput").value.trim();
  if (entered) apiKey = entered;
  modelName = $("modelInput").value.trim() || "gemini-flash-latest";
  $("settingsStatus").textContent = apiKey ? "Settings saved for this browser session." : "Enter an API key first.";
});
$("forgetKeyBtn").addEventListener("click", () => { apiKey = ""; $("apiKeyInput").value = ""; $("settingsStatus").textContent = "API key cleared from memory."; });
$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("light");
  try { localStorage.setItem("nova-theme", document.body.classList.contains("light") ? "light" : "dark"); } catch {}
});
$("menuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
$("suggestionGrid");
document.querySelectorAll(".suggestion").forEach(btn => btn.addEventListener("click", () => sendMessage(btn.dataset.prompt)));
$("voiceBtn").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert("Voice input is not supported by this browser. Try a recent version of Chrome or Edge."); return; }
  const recognition = new SpeechRecognition(); recognition.lang = navigator.language || "en-US"; recognition.interimResults = false;
  $("voiceBtn").querySelector("span").textContent = "Listening…";
  recognition.onresult = event => { inputEl.value = (inputEl.value + " " + event.results[0][0].transcript).trim(); resizeInput(); inputEl.focus(); };
  recognition.onerror = () => {};
  recognition.onend = () => { $("voiceBtn").querySelector("span").textContent = "Voice"; };
  recognition.start();
});
try { if (localStorage.getItem("nova-theme") === "light") document.body.classList.add("light"); } catch {}
loadChats();
