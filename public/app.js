const storageKey = "chinese-vocab-hero-state-v1";
const batchesKey = "chinese-vocab-hero-batches-v1";
const heroes = ["Superman", "Spider-Man", "Transformers", "Nezha", "Pikachu"];
const chatUnlockCorrect = 3;
const celebrationLines = [
  "太棒了！这个词读得很有力量！",
  "好功夫！你的中文又进步了！",
  "读对啦！继续保持，小英雄！",
  "漂亮！这个发音很精神！"
];

const els = {
  statusStrip: document.querySelector("#statusStrip"),
  resetButton: document.querySelector("#resetButton"),
  photoInput: document.querySelector("#photoInput"),
  manualButton: document.querySelector("#manualButton"),
  savedBatchesSection: document.querySelector("#savedBatchesSection"),
  batchList: document.querySelector("#batchList"),
  uploadView: document.querySelector("#uploadView"),
  reviewView: document.querySelector("#reviewView"),
  practiceView: document.querySelector("#practiceView"),
  doneView: document.querySelector("#doneView"),
  wordList: document.querySelector("#wordList"),
  addWordButton: document.querySelector("#addWordButton"),
  startButton: document.querySelector("#startButton"),
  progressLabel: document.querySelector("#progressLabel"),
  scorePill: document.querySelector("#scorePill"),
  wordStage: document.querySelector("#wordStage"),
  currentWord: document.querySelector("#currentWord"),
  currentPinyin: document.querySelector("#currentPinyin"),
  listenWordButton: document.querySelector("#listenWordButton"),
  recordButton: document.querySelector("#recordButton"),
  coachCard: document.querySelector("#coachCard"),
  coachLine: document.querySelector("#coachLine"),
  feedbackBox: document.querySelector("#feedbackBox"),
  chatPanel: document.querySelector("#chatPanel"),
  chatMessages: document.querySelector("#chatMessages"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  chatSendButton: document.querySelector("#chatSendButton"),
  sentenceButton: document.querySelector("#sentenceButton"),
  sentencePanel: document.querySelector("#sentencePanel"),
  sentenceHero: document.querySelector("#sentenceHero"),
  sentenceText: document.querySelector("#sentenceText"),
  sentencePinyin: document.querySelector("#sentencePinyin"),
  replaySentenceButton: document.querySelector("#replaySentenceButton"),
  nextButton: document.querySelector("#nextButton"),
  doneStats: document.querySelector("#doneStats"),
  againButton: document.querySelector("#againButton")
};

let state = loadState();
let batches = loadBatches();
let activeAudioUrl = null;
let mediaRecorder = null;
let recordingChunks = [];
let lastRenderedIndex = -1;
let capabilities = {
  openAiConfigured: false,
  anthropicConfigured: false,
  azureConfigured: false,
  languageProvider: "local"
};

function freshState() {
  return {
    view: "upload",
    items: [],
    currentIndex: 0,
    correct: 0,
    attempts: 0,
    currentBatchId: null,
    chatOpen: false,
    chatHistory: []
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.items) return { ...freshState(), ...saved };
  } catch {
    localStorage.removeItem(storageKey);
  }
  return freshState();
}

function loadBatches() {
  try {
    const saved = JSON.parse(localStorage.getItem(batchesKey));
    return Array.isArray(saved) ? saved : [];
  } catch {
    localStorage.removeItem(batchesKey);
    return [];
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function saveBatches() {
  localStorage.setItem(batchesKey, JSON.stringify(batches));
}

function setStatus(message) {
  els.statusStrip.textContent = message || "";
}

function showView(name) {
  for (const view of [els.uploadView, els.reviewView, els.practiceView, els.doneView]) {
    view.classList.remove("active");
  }
  document.querySelector(`#${name}View`).classList.add("active");
  state.view = name;
  saveState();
}

async function apiJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}

async function refreshCapabilities() {
  try {
    const response = await fetch("/api/health");
    if (response.ok) capabilities = await response.json();
  } catch {
    capabilities = {
      openAiConfigured: false,
      anthropicConfigured: false,
      azureConfigured: false,
      languageProvider: "local"
    };
  }
}

async function imageFileToDataUrls(file) {
  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const image = new Image();
  image.src = rawDataUrl;
  await image.decode();

  const render = (maxSide, quality) => {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };

  return {
    imageDataUrl: render(1800, 0.86),
    thumbnailDataUrl: render(420, 0.72)
  };
}

async function handlePhotoChange(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    if (capabilities.languageProvider === "local") {
      throw new Error("照片识别需要 Anthropic 或 OpenAI API key。现在可以先点“手动输入”。");
    }
    setStatus("正在读照片...");
    const { imageDataUrl, thumbnailDataUrl } = await imageFileToDataUrls(file);
    const result = await apiJson("/api/ocr", { imageDataUrl });
    state.items = prepareItemsForPractice(result.items);
    state.currentIndex = 0;
    state.correct = 0;
    state.attempts = 0;
    state.chatOpen = false;
    state.chatHistory = [];
    state.currentBatchId = saveCurrentBatch({ thumbnailDataUrl });
    saveState();
    renderSavedBatches();
    renderReview();
    showView("review");
    setStatus(`找到 ${state.items.length} 个词。`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    event.target.value = "";
  }
}

function prepareItemsForPractice(items) {
  return items.map((item, index) => ({
    ...item,
    id: item.id || crypto.randomUUID(),
    number: index + 1,
    sentence: null,
    sentenceRevealed: false,
    completed: false,
    lastResult: null
  }));
}

function batchItemsFromState() {
  return state.items
    .filter((item) => item.word?.trim() && item.pinyin?.trim())
    .map((item, index) => ({
      id: item.id || crypto.randomUUID(),
      number: index + 1,
      word: item.word.trim(),
      pinyin: item.pinyin.trim(),
      displayPinyin: (item.displayPinyin || item.pinyin).trim()
    }));
}

function batchTitle(items) {
  const words = items.slice(0, 3).map((item) => item.word).filter(Boolean).join("、");
  return words || "词语表";
}

function saveCurrentBatch({ thumbnailDataUrl } = {}) {
  const items = batchItemsFromState();
  if (!items.length) return state.currentBatchId || null;

  const id = state.currentBatchId || crypto.randomUUID();
  const existing = batches.find((batch) => batch.id === id);
  const savedBatch = {
    id,
    title: batchTitle(items),
    count: items.length,
    updatedAt: Date.now(),
    thumbnailDataUrl: thumbnailDataUrl || existing?.thumbnailDataUrl || "",
    items
  };

  batches = [savedBatch, ...batches.filter((batch) => batch.id !== id)].slice(0, 12);
  saveBatches();
  return id;
}

function renderSavedBatches() {
  els.batchList.innerHTML = "";
  els.savedBatchesSection.classList.toggle("hidden", !batches.length);
  for (const batch of batches) {
    const button = document.createElement("button");
    button.className = "batch-card";
    button.type = "button";
    const thumb = batch.thumbnailDataUrl
      ? `<img class="batch-thumb" src="${batch.thumbnailDataUrl}" alt="">`
      : `<div class="batch-thumb placeholder" aria-hidden="true">词</div>`;
    button.innerHTML = `
      ${thumb}
      <span class="batch-copy">
        <strong>${escapeHtml(batch.title)}</strong>
        <span>${batch.count || batch.items?.length || 0} 个词</span>
      </span>
    `;
    button.addEventListener("click", () => openBatch(batch.id));
    els.batchList.append(button);
  }
}

function openBatch(batchId) {
  const batch = batches.find((entry) => entry.id === batchId);
  if (!batch) return;
  state = {
    ...freshState(),
    view: "review",
    currentBatchId: batch.id,
    items: prepareItemsForPractice(batch.items || [])
  };
  lastRenderedIndex = -1;
  saveState();
  renderReview();
  showView("review");
  setStatus(`已打开 ${batch.count || batch.items.length} 个词。`);
}

function renderReview() {
  els.wordList.innerHTML = "";
  state.items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "word-row";
    row.innerHTML = `
      <div class="word-number">${index + 1}</div>
      <input class="word-input" aria-label="Chinese word ${index + 1}" value="${escapeHtml(item.word)}">
      <input class="pinyin-input" aria-label="Pinyin ${index + 1}" value="${escapeHtml(item.pinyin)}">
      <button class="delete-button" type="button" aria-label="Delete row">×</button>
    `;
    row.querySelector(".word-input").addEventListener("input", (event) => {
      item.word = event.target.value.trim();
      item.displayPinyin = item.displayPinyin || item.pinyin;
      saveState();
    });
    row.querySelector(".pinyin-input").addEventListener("input", (event) => {
      item.pinyin = event.target.value.trim();
      item.displayPinyin = event.target.value.trim();
      saveState();
    });
    row.querySelector(".delete-button").addEventListener("click", () => {
      state.items.splice(index, 1);
      state.items.forEach((entry, entryIndex) => {
        entry.number = entryIndex + 1;
      });
      saveState();
      renderReview();
    });
    els.wordList.append(row);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getCurrentItem() {
  return state.items[state.currentIndex];
}

function renderPractice() {
  const item = getCurrentItem();
  if (!item) {
    renderDone();
    showView("done");
    return;
  }

  if (lastRenderedIndex !== state.currentIndex) {
    els.wordStage.classList.remove("show-pinyin", "success-pop");
    lastRenderedIndex = state.currentIndex;
  }

  els.progressLabel.textContent = `${state.currentIndex + 1} / ${state.items.length}`;
  els.scorePill.textContent = `${state.correct} ✓`;
  els.currentWord.textContent = item.word || "字";
  els.currentPinyin.textContent = item.displayPinyin || item.pinyin || "";
  renderCoach();
  renderFeedback(item.lastResult);
  els.feedbackBox.className = `feedback ${item.lastResult?.ok ? "good" : item.lastResult ? "try" : ""}`;
  renderSentence(item);
  saveState();
}

function isChatUnlocked() {
  return state.correct >= chatUnlockCorrect;
}

function remainingForChat() {
  return Math.max(0, chatUnlockCorrect - state.correct);
}

function renderCoach() {
  const remaining = remainingForChat();
  const unlocked = isChatUnlocked();
  els.coachCard.classList.toggle("locked", !unlocked);
  els.coachCard.setAttribute("aria-disabled", String(!unlocked));
  els.coachCard.setAttribute("aria-label", unlocked ? "跟我聊天" : `再读对 ${remaining} 个词，就能跟我聊天`);
  if (isChatUnlocked()) {
    els.coachLine.textContent = state.chatOpen ? "来，跟教练聊两句中文。" : "聊天已经打开了，练累了就来聊聊。";
  } else {
    els.coachLine.textContent = `再读对 ${remaining} 个词，就能跟我聊天。`;
  }
  els.chatPanel.classList.toggle("hidden", !state.chatOpen || !isChatUnlocked());
  renderChatMessages();
}

function renderFeedback(result) {
  if (!result) {
    els.feedbackBox.replaceChildren();
    return;
  }

  const title = document.createElement("strong");
  title.textContent = result.ok ? "读对啦！" : "差一点，再来一口气。";

  const detail = document.createElement("span");
  detail.textContent = `我听到：${result.transcript || "没听清"}`;

  els.feedbackBox.replaceChildren(title, detail);
}

function renderSentence(item) {
  if (!item.sentenceRevealed || !item.sentence) {
    els.sentencePanel.classList.add("hidden");
    els.nextButton.classList.add("hidden");
    els.sentenceButton.classList.toggle("hidden", !item.lastResult);
    return;
  }

  els.sentenceButton.classList.add("hidden");
  els.sentenceHero.textContent = item.sentence.hero;
  els.sentenceText.textContent = item.sentence.sentence;
  els.sentencePinyin.textContent = item.sentence.pinyin;
  els.sentencePanel.classList.remove("hidden");
  els.nextButton.classList.remove("hidden");
}

async function playTts(payload) {
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error || "Audio failed.");
  }
  const blob = await response.blob();
  activeAudioUrl = URL.createObjectURL(blob);
  const audio = new Audio(activeAudioUrl);
  await audio.play();
}

async function playCoachLine(text) {
  els.coachLine.textContent = text;
  await playTts({
    mode: "sentence",
    text,
    word: getCurrentItem()?.word,
    pinyin: getCurrentItem()?.pinyin
  });
}

async function listenToCurrentWord() {
  const item = getCurrentItem();
  if (!item) return;
  try {
    setStatus("正在播放...");
    await playTts({
      mode: "word",
      text: item.word,
      word: item.word,
      pinyin: item.pinyin
    });
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function replaySentence() {
  const item = getCurrentItem();
  if (!item?.sentence) return;
  try {
    await playSentence(item);
  } catch (error) {
    setStatus(error.message);
  }
}

async function playSentence(item) {
  await playTts({
    mode: "sentence",
    text: item.sentence.sentence,
    word: item.word,
    pinyin: item.pinyin
  });
}

function normalizeChinese(value) {
  return String(value || "").replace(/[^\u3400-\u9fff]/g, "");
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function fuzzyMatches(target, transcript) {
  const expected = normalizeChinese(target);
  const heard = normalizeChinese(transcript);
  if (!expected || !heard) return false;
  if (heard.includes(expected) || expected.includes(heard)) return true;
  if (expected.length > 1 && levenshtein(expected, heard) <= 1) return true;
  return false;
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function recordPronunciation() {
  if (!capabilities.openAiConfigured) {
    await recordWithBrowserSpeech();
    return;
  }

  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: pickAudioMimeType() });
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      handleRecordingBlob(new Blob(recordingChunks, { type: mediaRecorder.mimeType }));
    });
    mediaRecorder.start();
    els.recordButton.classList.add("recording");
    els.recordButton.textContent = "再按停止";
    setStatus("正在听...");
  } catch (error) {
    setStatus(error.message.includes("Permission") ? "麦克风没有打开。" : error.message);
  }
}

function pickAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function handleRecordingBlob(blob) {
  const item = getCurrentItem();
  els.recordButton.classList.remove("recording");
  els.recordButton.textContent = "按下录音";

  try {
    setStatus("正在判断...");
    const audioDataUrl = await blobToDataUrl(blob);
    const { text } = await apiJson("/api/transcribe", { audioDataUrl });
    await handleTranscript(item, text);
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function recordWithBrowserSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("这个浏览器没有中文语音识别。可以用 Chrome/Safari，或加 OpenAI API key。");
    return;
  }

  const item = getCurrentItem();
  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  els.recordButton.classList.add("recording");
  els.recordButton.textContent = "正在听";
  setStatus("浏览器正在听...");

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    recognition.addEventListener("result", async (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((alternative) => alternative.transcript)
        .join(" ");
      try {
        await handleTranscript(item, transcript);
      } catch (error) {
        setStatus(error.message);
      }
      finish();
    });
    recognition.addEventListener("error", (event) => {
      setStatus(event.error === "not-allowed" ? "麦克风没有打开。" : "没有听清，再试一次。");
      finish();
    });
    recognition.addEventListener("end", () => {
      els.recordButton.classList.remove("recording");
      els.recordButton.textContent = "按下录音";
      finish();
    });
    recognition.start();
  });
}

async function handleTranscript(item, text) {
  const ok = fuzzyMatches(item.word, text);
  item.lastResult = { ok, transcript: text };
  item.completed = true;
  item.sentenceRevealed = false;
  state.attempts += 1;
  if (ok) state.correct += 1;
  if (ok) {
    els.wordStage.classList.remove("success-pop");
    requestAnimationFrame(() => els.wordStage.classList.add("success-pop"));
  }
  renderPractice();
  setStatus(ok ? "读对了，点“造句”听一句好玩的。" : "先点“造句”听一句，再试下一个。");
  if (ok) {
    const line = celebrationLines[Math.floor(Math.random() * celebrationLines.length)];
    playCoachLine(line).catch((error) => setStatus(error.message));
  } else {
    playCoachLine("差一点，再试一次，或者看看拼音。").catch((error) => setStatus(error.message));
  }
}

async function revealSentence(item) {
  if (!item.sentence) {
    setStatus("正在造句...");
    els.sentenceButton.disabled = true;
    if (capabilities.languageProvider !== "local") {
      try {
        item.sentence = await apiJson("/api/sentence", {
          word: item.word,
          pinyin: item.pinyin
        });
      } catch (error) {
        item.sentence = makeLocalSentence(item);
        setStatus(`${error.message} 已改用本地句子。`);
      }
    } else {
      item.sentence = makeLocalSentence(item);
    }
    saveState();
  }
  item.sentenceRevealed = true;
  saveState();
  renderPractice();
  try {
    await playSentence(item);
    setStatus("");
  } finally {
    els.sentenceButton.disabled = false;
  }
}

function makeLocalSentence(item) {
  const hero = heroes[Math.floor(Math.random() * heroes.length)];
  const displayPinyin = item.displayPinyin || item.pinyin;
  const templates = {
    Superman: {
      sentence: `超人举起${item.word}飞走了。`,
      pinyin: `Chāo rén jǔ qǐ ${displayPinyin} fēi zǒu le.`,
      english: `Superman lifted ${item.word} and flew away.`
    },
    "Spider-Man": {
      sentence: `蜘蛛侠用${item.word}荡秋千。`,
      pinyin: `Zhī zhū xiá yòng ${displayPinyin} dàng qiū qiān.`,
      english: `Spider-Man used ${item.word} as a swing.`
    },
    Transformers: {
      sentence: `变形金刚把${item.word}变大了。`,
      pinyin: `Biàn xíng jīn gāng bǎ ${displayPinyin} biàn dà le.`,
      english: `The Transformer made ${item.word} huge.`
    },
    Nezha: {
      sentence: `哪吒踩着${item.word}转圈。`,
      pinyin: `Né zhā cǎi zhe ${displayPinyin} zhuàn quān.`,
      english: `Nezha spun around on ${item.word}.`
    },
    Pikachu: {
      sentence: `皮卡丘抱着${item.word}跳舞。`,
      pinyin: `Pí kǎ qiū bào zhe ${displayPinyin} tiào wǔ.`,
      english: `Pikachu hugged ${item.word} and danced.`
    }
  };
  return { hero, ...templates[hero] };
}

function studiedItemsForChat() {
  return state.items
    .slice(0, Math.max(state.currentIndex + 1, 1))
    .map((item) => ({
      word: item.word,
      pinyin: item.pinyin,
      displayPinyin: item.displayPinyin,
      completed: Boolean(item.completed),
      lastOk: Boolean(item.lastResult?.ok)
    }));
}

function renderChatMessages() {
  els.chatMessages.innerHTML = "";
  for (const turn of state.chatHistory.slice(-12)) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${turn.role === "kid" ? "kid" : "coach"}`;
    bubble.textContent = turn.text;
    els.chatMessages.append(bubble);
  }
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function toggleChat() {
  if (!isChatUnlocked()) {
    const remaining = remainingForChat();
    const line = `还差 ${remaining} 个词。再读对 ${remaining} 个，就能跟我聊天！`;
    try {
      await playCoachLine(line);
    } catch (error) {
      setStatus(error.message);
    }
    return;
  }

  state.chatOpen = !state.chatOpen;
  saveState();
  renderPractice();
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (!isChatUnlocked()) return toggleChat();

  const message = els.chatInput.value.trim();
  if (!message) return;

  const kidTurn = { role: "kid", text: message };
  state.chatHistory.push(kidTurn);
  els.chatInput.value = "";
  els.chatSendButton.disabled = true;
  saveState();
  renderChatMessages();

  try {
    setStatus("教练正在想...");
    const { reply } = await apiJson("/api/chat", {
      message,
      studiedItems: studiedItemsForChat(),
      currentWord: getCurrentItem(),
      history: state.chatHistory
    });
    const coachTurn = { role: "coach", text: reply };
    state.chatHistory.push(coachTurn);
    saveState();
    renderChatMessages();
    await playCoachLine(reply);
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  } finally {
    els.chatSendButton.disabled = false;
  }
}

function nextWord() {
  state.currentIndex += 1;
  state.chatOpen = false;
  if (state.currentIndex >= state.items.length) {
    renderDone();
    showView("done");
  } else {
    renderPractice();
    showView("practice");
  }
}

function renderDone() {
  const percent = state.attempts ? Math.round((state.correct / state.attempts) * 100) : 0;
  els.doneStats.textContent = `${state.correct} / ${state.attempts} 次读对，正确率 ${percent}%。`;
}

function restartPractice() {
  state.currentIndex = 0;
  state.correct = 0;
  state.attempts = 0;
  state.chatOpen = false;
  state.chatHistory = [];
  state.items = state.items.map((item) => ({ ...item, completed: false, lastResult: null, sentenceRevealed: false }));
  saveState();
  renderPractice();
  showView("practice");
}

function resetAll() {
  localStorage.removeItem(storageKey);
  state = freshState();
  lastRenderedIndex = -1;
  renderSavedBatches();
  showView("upload");
  setStatus(capabilities.languageProvider === "local" ? "没有 Anthropic/OpenAI API key：照片识别先不可用，但可以手动输入练习。" : "");
}

function addWordRow() {
  state.items.push({
    id: crypto.randomUUID(),
    number: state.items.length + 1,
    word: "",
    pinyin: "",
    displayPinyin: "",
    sentence: null,
    sentenceRevealed: false,
    completed: false,
    lastResult: null
  });
  saveState();
  renderReview();
}

function startManualEntry() {
  if (!state.items.length) addWordRow();
  state.currentBatchId = state.currentBatchId || null;
  renderReview();
  showView("review");
  setStatus("");
}

function startPractice() {
  state.items = state.items
    .filter((item) => item.word.trim() && item.pinyin.trim())
    .map((item, index) => ({ ...item, number: index + 1 }));

  if (!state.items.length) {
    setStatus("先保留至少一个词。");
    return;
  }

  state.currentIndex = Math.min(state.currentIndex, state.items.length - 1);
  state.currentBatchId = saveCurrentBatch();
  renderSavedBatches();
  saveState();
  renderPractice();
  showView("practice");
  setStatus("");
}

els.photoInput.addEventListener("change", handlePhotoChange);
els.manualButton.addEventListener("click", startManualEntry);
els.addWordButton.addEventListener("click", addWordRow);
els.startButton.addEventListener("click", startPractice);
els.listenWordButton.addEventListener("click", listenToCurrentWord);
els.recordButton.addEventListener("click", recordPronunciation);
els.coachCard.addEventListener("click", toggleChat);
els.coachCard.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleChat();
});
els.chatForm.addEventListener("submit", sendChatMessage);
els.sentenceButton.addEventListener("click", () => {
  const item = getCurrentItem();
  if (item) revealSentence(item);
});
els.replaySentenceButton.addEventListener("click", replaySentence);
els.nextButton.addEventListener("click", nextWord);
els.againButton.addEventListener("click", restartPractice);
els.resetButton.addEventListener("click", resetAll);
els.wordStage.addEventListener("click", () => {
  els.wordStage.classList.toggle("show-pinyin");
});
els.wordStage.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  els.wordStage.classList.toggle("show-pinyin");
});

async function init() {
  await refreshCapabilities();
  renderSavedBatches();
  if (state.items.length && state.view === "review") {
    renderReview();
    showView("review");
  } else if (state.items.length && state.view === "done") {
    renderDone();
    showView("done");
  } else if (state.items.length) {
    renderPractice();
    showView("practice");
    setStatus("已恢复上次进度。");
  } else {
    showView("upload");
    if (capabilities.languageProvider === "local") {
      setStatus("没有 Anthropic/OpenAI API key：照片识别先不可用，但可以手动输入练习。");
    }
  }
}

await init();
