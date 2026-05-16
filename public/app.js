const storageKey = "chinese-vocab-hero-state-v1";
const batchesKey = "chinese-vocab-hero-batches-v1";
const settingsKey = "chinese-vocab-hero-settings-v1";
const defaultCoachPersona = "我是成龙 Jackie Chan。";
const defaultCoachAvatar = "/coach.jpg";
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
  adminToggleButton: document.querySelector("#adminToggleButton"),
  photoInput: document.querySelector("#photoInput"),
  manualButton: document.querySelector("#manualButton"),
  newBatchButton: document.querySelector("#newBatchButton"),
  adminSettings: document.querySelector("#adminSettings"),
  personaInput: document.querySelector("#personaInput"),
  avatarInput: document.querySelector("#avatarInput"),
  avatarPreview: document.querySelector("#avatarPreview"),
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
  coachPortrait: document.querySelector("#coachPortrait"),
  coachLine: document.querySelector("#coachLine"),
  coachProgress: document.querySelector("#coachProgress"),
  feedbackBox: document.querySelector("#feedbackBox"),
  chatPanel: document.querySelector("#chatPanel"),
  chatMessages: document.querySelector("#chatMessages"),
  voiceChatButton: document.querySelector("#voiceChatButton"),
  voiceChatHint: document.querySelector("#voiceChatHint"),
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
let settings = loadSettings();
let activeAudioUrl = null;
let mediaRecorder = null;
let recordingChunks = [];
let liveChat = null;
let lastRenderedIndex = -1;
let capabilities = {
  openAiConfigured: false,
  anthropicConfigured: false,
  azureConfigured: false,
  volcengineRealtimeConfigured: false,
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
    chatCredits: 0,
    chatDialogId: null,
    chatHistory: []
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.items) {
      return {
        ...freshState(),
        ...saved,
        chatCredits: saved.chatCredits ?? Math.min(saved.correct || 0, chatUnlockCorrect)
      };
    }
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

function loadSettings() {
  try {
    return {
      personaPrompt: defaultCoachPersona,
      avatarDataUrl: defaultCoachAvatar,
      ...JSON.parse(localStorage.getItem(settingsKey))
    };
  } catch {
    localStorage.removeItem(settingsKey);
    return {
      personaPrompt: defaultCoachPersona,
      avatarDataUrl: defaultCoachAvatar
    };
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function saveBatches() {
  localStorage.setItem(batchesKey, JSON.stringify(batches));
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function renderSettings() {
  const persona = settings.personaPrompt || defaultCoachPersona;
  const avatar = settings.avatarDataUrl || defaultCoachAvatar;
  els.personaInput.value = persona;
  els.avatarPreview.src = avatar;
  if (els.coachPortrait) {
    els.coachPortrait.src = avatar;
    els.coachPortrait.hidden = false;
  }
}

function setStatus(message) {
  els.statusStrip.textContent = message || "";
}

function normalizePinyinText(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

function showView(name) {
  for (const view of [els.uploadView, els.reviewView, els.practiceView, els.doneView]) {
    view.classList.remove("active");
  }
  document.querySelector(`#${name}View`).classList.add("active");
  state.view = name;
  saveState();
  renderModeToggle();
}

function isKidView() {
  return state.view === "practice" || state.view === "done";
}

function renderModeToggle() {
  const kidView = isKidView();
  els.adminToggleButton.textContent = kidView ? "⚙" : "孩";
  els.adminToggleButton.title = kidView ? "家长设置" : "儿童界面";
  els.adminToggleButton.setAttribute("aria-label", kidView ? "家长设置" : "儿童界面");
  els.adminToggleButton.classList.toggle("active", !kidView);
}

function toggleParentKidMode() {
  if (isKidView()) {
    showView("upload");
    setStatus("");
    return;
  }
  if (state.items.length) {
    renderPractice();
    showView("practice");
  } else {
    setStatus("还没有词表。先上传照片、选一个词表，或者手动输入。");
  }
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
      volcengineRealtimeConfigured: false,
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

async function imageFileToAvatarDataUrl(file) {
  const { thumbnailDataUrl } = await imageFileToDataUrls(file);
  return thumbnailDataUrl;
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
    state.chatCredits = 0;
    state.chatHistory = [];
    state.chatDialogId = null;
    state.currentBatchId = null;
    state.currentBatchId = saveCurrentBatch({ thumbnailDataUrl, createNew: true });
    saveState();
    renderSavedBatches();
    renderReview();
    showView("review");
    setStatus(`已新建词表，找到 ${state.items.length} 个词。请先确认，再开始练习。`);
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
    pinyin: normalizePinyinText(item.pinyin),
    displayPinyin: normalizePinyinText(item.displayPinyin || item.pinyin),
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
      pinyin: normalizePinyinText(item.pinyin),
      displayPinyin: normalizePinyinText(item.displayPinyin || item.pinyin)
    }));
}

function batchTitle(items) {
  const words = items.slice(0, 3).map((item) => item.word).filter(Boolean).join("、");
  return words || "词语表";
}

function saveCurrentBatch({ thumbnailDataUrl, createNew = false } = {}) {
  const items = batchItemsFromState();
  if (!items.length) return state.currentBatchId || null;

  const id = createNew ? crypto.randomUUID() : state.currentBatchId || crypto.randomUUID();
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
    const card = document.createElement("article");
    card.className = `batch-card${batch.id === state.currentBatchId ? " active" : ""}`;
    const openButton = document.createElement("button");
    openButton.className = "batch-open";
    openButton.type = "button";
    const thumb = batch.thumbnailDataUrl
      ? `<img class="batch-thumb" src="${batch.thumbnailDataUrl}" alt="">`
      : `<div class="batch-thumb placeholder" aria-hidden="true">词</div>`;
    openButton.innerHTML = `
      ${thumb}
      <span class="batch-copy">
        <strong>${escapeHtml(batch.title)}</strong>
        <span>${batch.count || batch.items?.length || 0} 个词${batch.id === state.currentBatchId ? " · 当前" : ""}</span>
      </span>
    `;
    openButton.addEventListener("click", () => openBatch(batch.id));

    const restartButton = document.createElement("button");
    restartButton.className = "batch-reset";
    restartButton.type = "button";
    restartButton.textContent = "从头练";
    restartButton.addEventListener("click", () => restartBatch(batch.id));

    card.append(openButton, restartButton);
    els.batchList.append(card);
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

function restartBatch(batchId) {
  openBatch(batchId);
  const batch = batches.find((entry) => entry.id === batchId);
  if (!batch) return;
  startPractice();
  setStatus(`已从头开始：${batch.title}。`);
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
      item.pinyin = normalizePinyinText(event.target.value);
      item.displayPinyin = normalizePinyinText(event.target.value);
      event.target.value = item.pinyin;
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
  els.currentPinyin.textContent = normalizePinyinText(item.displayPinyin || item.pinyin);
  renderCoach();
  renderFeedback(item.lastResult);
  els.feedbackBox.className = `feedback ${item.lastResult?.ok ? "good" : item.lastResult ? "try" : "hidden"}`;
  renderSentence(item);
  saveState();
}

function chatCreditCount() {
  return Math.min(Math.max(Number(state.chatCredits) || 0, 0), chatUnlockCorrect);
}

function isChatUnlocked() {
  return chatCreditCount() >= chatUnlockCorrect;
}

function remainingForChat() {
  return Math.max(0, chatUnlockCorrect - chatCreditCount());
}

function renderCoach() {
  els.coachPortrait.src = settings.avatarDataUrl || defaultCoachAvatar;
  els.coachPortrait.hidden = false;
  const remaining = remainingForChat();
  const unlocked = isChatUnlocked();
  const progressText = unlocked ? "开聊" : `${chatCreditCount()} / ${chatUnlockCorrect}`;
  els.coachCard.classList.toggle("locked", !unlocked);
  els.coachCard.classList.toggle("ready", unlocked && !liveChat);
  els.coachCard.classList.toggle("live", Boolean(liveChat));
  els.coachCard.setAttribute("aria-disabled", String(!unlocked));
  els.coachCard.setAttribute("aria-label", unlocked ? `跟我聊天，${progressText}` : `再读对 ${remaining} 个词，就能跟我聊天，${progressText}`);
  els.coachProgress.textContent = progressText;
  if (liveChat) {
    els.coachLine.textContent = "我在听，直接说中文。";
  } else if (unlocked) {
    els.coachLine.textContent = "可以跟成龙实时聊天了，点这里开始。";
  } else {
    els.coachLine.textContent = `再读对 ${remaining} 个词，就能跟我聊天。`;
  }
  els.chatPanel.classList.toggle("hidden", !state.chatOpen || !isChatUnlocked());
  els.voiceChatButton.textContent = liveChat ? "结束实时聊天" : "开始实时聊天";
  els.voiceChatButton.classList.toggle("recording", Boolean(liveChat));
  renderChatMessages();
}

function renderFeedback(result) {
  if (!result) {
    els.feedbackBox.replaceChildren();
    els.feedbackBox.classList.add("hidden");
    return;
  }

  els.feedbackBox.classList.remove("hidden");
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
  els.sentencePinyin.textContent = normalizePinyinText(item.sentence.pinyin);
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

function transcriptCandidates(value) {
  return String(value || "")
    .split(/[\s,，.。!！?？、;；:：/|]+/)
    .map(normalizeChinese)
    .filter(Boolean);
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
  const candidates = transcriptCandidates(transcript);
  if (!expected || !candidates.length) return false;
  if (candidates.some((heard) => heard === expected)) return true;
  if (expected.length >= 3) {
    return candidates.some((heard) => heard.length === expected.length && levenshtein(expected, heard) <= 1);
  }
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
  const item = getCurrentItem();
  const transcript = await listenWithBrowserSpeech({
    onStart: () => {
      els.recordButton.classList.add("recording");
      els.recordButton.textContent = "正在听";
      setStatus("浏览器正在听...");
    },
    onEnd: () => {
      els.recordButton.classList.remove("recording");
      els.recordButton.textContent = "按下录音";
    }
  });
  if (!transcript) return;

  try {
    await handleTranscript(item, transcript);
  } catch (error) {
    setStatus(error.message);
  }
}

async function listenWithBrowserSpeech({ onStart, onEnd } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("这个浏览器没有中文语音识别。可以用 Chrome/Safari，或加 OpenAI API key。");
    return "";
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  onStart?.();

  const transcript = await new Promise((resolve) => {
    let settled = false;
    const finish = (value = "") => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    recognition.addEventListener("result", (event) => {
      const transcript = Array.from(event.results)
        .flatMap((result) => Array.from(result))
        .map((alternative) => alternative.transcript)
        .join(" ");
      finish(transcript);
    });
    recognition.addEventListener("error", (event) => {
      setStatus(event.error === "not-allowed" ? "麦克风没有打开。" : "没有听清，再试一次。");
      finish();
    });
    recognition.addEventListener("end", () => {
      onEnd?.();
      finish();
    });
    recognition.start();
  });

  return transcript;
}

async function handleTranscript(item, text) {
  const ok = fuzzyMatches(item.word, text);
  item.lastResult = { ok, transcript: text };
  item.completed = true;
  item.sentenceRevealed = false;
  state.attempts += 1;
  if (ok) {
    state.correct += 1;
    state.chatCredits = Math.min(chatUnlockCorrect, chatCreditCount() + 1);
  }
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
  const displayPinyin = normalizePinyinText(item.displayPinyin || item.pinyin);
  const templates = {
    Superman: {
      sentence: `超人举起${item.word}飞走了。`,
      pinyin: `chāo rén jǔ qǐ ${displayPinyin} fēi zǒu le.`,
      english: `Superman lifted ${item.word} and flew away.`
    },
    "Spider-Man": {
      sentence: `蜘蛛侠用${item.word}荡秋千。`,
      pinyin: `zhī zhū xiá yòng ${displayPinyin} dàng qiū qiān.`,
      english: `Spider-Man used ${item.word} as a swing.`
    },
    Transformers: {
      sentence: `变形金刚把${item.word}变大了。`,
      pinyin: `biàn xíng jīn gāng bǎ ${displayPinyin} biàn dà le.`,
      english: `The Transformer made ${item.word} huge.`
    },
    Nezha: {
      sentence: `哪吒踩着${item.word}转圈。`,
      pinyin: `né zhā cǎi zhe ${displayPinyin} zhuàn quān.`,
      english: `Nezha spun around on ${item.word}.`
    },
    Pikachu: {
      sentence: `皮卡丘抱着${item.word}跳舞。`,
      pinyin: `pí kǎ qiū bào zhe ${displayPinyin} tiào wǔ.`,
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

function ensureChatDialogId() {
  if (!state.chatDialogId) {
    state.chatDialogId = `atlas-${state.currentBatchId || "manual"}-${crypto.randomUUID()}`;
    saveState();
  }
  return state.chatDialogId;
}

function recentTurnsForChat() {
  return state.chatHistory
    .filter((turn) => !turn.live && turn.text)
    .slice(-20)
    .map((turn) => ({
      role: turn.role,
      text: turn.text
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

function addChatTurn(role, text) {
  state.chatHistory.push({ role, text });
  saveState();
  renderChatMessages();
}

function chatIntroLine() {
  const words = state.items
    .filter((item) => item.completed || item.lastResult?.ok)
    .slice(-4)
    .map((item) => item.word)
    .filter(Boolean);
  const current = getCurrentItem()?.word;
  const wordText = words.length ? words.join("、") : current || "中文";
  return `我是成龙，刚才你练了${wordText}，很有功夫！选一个词，跟我说一句中文吧。`;
}

async function toggleChat() {
  if (liveChat) {
    stopRealtimeChat();
    return;
  }
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

  state.chatOpen = true;
  saveState();
  renderPractice();
  await startRealtimeChat();
}

function updateLiveChatBubble(role, text, { append = false } = {}) {
  const last = state.chatHistory[state.chatHistory.length - 1];
  if (last?.role === role && last.live) {
    last.text = append ? last.text + text : text;
  } else {
    state.chatHistory.push({ role, text, live: true });
  }
  renderChatMessages();
}

function finishLiveBubbles() {
  for (const turn of state.chatHistory) delete turn.live;
  saveState();
}

function downsampleFloat32(input, inputRate, outputRate) {
  if (outputRate === inputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    output[i] = input[Math.floor(i * ratio)] || 0;
  }
  return output;
}

function floatToInt16Buffer(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function base64Pcm16ToFloat32(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

function playRealtimeAudioChunk(samples, sampleRate) {
  if (!liveChat?.audioContext || !samples.length) return;
  const context = liveChat.audioContext;
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const startAt = Math.max(context.currentTime + 0.02, liveChat.playAt || 0);
  source.start(startAt);
  liveChat.playAt = startAt + buffer.duration;
}

async function startRealtimeChat() {
  if (!isChatUnlocked()) return toggleChat();
  if (liveChat) {
    stopRealtimeChat();
    return;
  }
  if (!capabilities.volcengineRealtimeConfigured) {
    const missing = [];
    if (capabilities.volcengineRealtimeMissing?.appId) missing.push("VOLCENGINE_REALTIME_APP_ID");
    if (capabilities.volcengineRealtimeMissing?.accessKey) missing.push("VOLCENGINE_REALTIME_ACCESS_TOKEN");
    const message = missing.length
      ? `实时聊天还没配置好：缺少 ${missing.join(" 和 ")}。`
      : "实时聊天还没配置好：需要填写火山端到端实时语音的 APP ID 和 API Key。";
    els.voiceChatHint.textContent = message;
    setStatus(message);
    state.chatOpen = false;
    saveState();
    renderCoach();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(1024, 1, 1);
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/realtime`);
    socket.binaryType = "arraybuffer";

    liveChat = { socket, stream, audioContext, source, processor, playAt: 0, partialKid: "" };
    renderCoach();
    els.voiceChatHint.textContent = "正在连接实时语音...";
    setStatus("正在连接实时语音...");

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        type: "start",
        context: {
          dialogId: ensureChatDialogId(),
          personaPrompt: settings.personaPrompt || defaultCoachPersona,
          studiedItems: studiedItemsForChat(),
          currentWord: getCurrentItem(),
          recentTurns: recentTurnsForChat()
        }
      }));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "ready") {
        liveChat.started = true;
        state.chatOpen = true;
        saveState();
        renderCoach();
        els.voiceChatHint.textContent = "成龙先出一招...";
        setStatus("成龙先出一招...");
        const intro = chatIntroLine();
        addChatTurn("coach", intro);
        playCoachLine(intro)
          .catch((error) => setStatus(error.message))
          .finally(() => {
            if (!liveChat || liveChat.socket !== socket) return;
            source.connect(processor);
            processor.connect(audioContext.destination);
            els.voiceChatHint.textContent = "正在实时聊天，直接说中文。";
            setStatus("");
          });
      } else if (message.type === "transcript") {
        if (message.final) {
          if (liveChat.partialKid) {
            const last = state.chatHistory[state.chatHistory.length - 1];
            if (last?.role === "kid" && last.live) last.text = message.text;
          } else {
            state.chatHistory.push({ role: "kid", text: message.text, live: true });
          }
          liveChat.partialKid = "";
          finishLiveBubbles();
          renderChatMessages();
        } else if (message.text) {
          liveChat.partialKid = message.text;
          updateLiveChatBubble("kid", message.text);
        }
      } else if (message.type === "replyText") {
        updateLiveChatBubble("coach", message.text || "", { append: true });
      } else if (message.type === "replyDone") {
        finishLiveBubbles();
      } else if (message.type === "audio") {
        playRealtimeAudioChunk(base64Pcm16ToFloat32(message.data), message.sampleRate || 24000);
      } else if (message.type === "error") {
        const errorMessage = message.message || "实时聊天断开了。";
        if (liveChat) liveChat.lastError = errorMessage;
        els.voiceChatHint.textContent = errorMessage;
        setStatus(errorMessage);
      }
    });

    socket.addEventListener("close", () => stopRealtimeChat(false, liveChat?.lastError || ""));

    processor.onaudioprocess = (event) => {
      if (!liveChat || socket.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const samples = downsampleFloat32(input, audioContext.sampleRate, 16000);
      socket.send(floatToInt16Buffer(samples));
    };
  } catch (error) {
    const message = error.message.includes("Permission") ? "麦克风没有打开。" : error.message;
    if (!liveChat) {
      state.chatOpen = false;
      saveState();
      renderCoach();
    }
    stopRealtimeChat(false, message);
  }
}

function stopRealtimeChat(closeSocket = true, message = "") {
  if (!liveChat) {
    if (message) {
      els.voiceChatHint.textContent = message;
      setStatus(message);
    }
    return;
  }
  const current = liveChat;
  liveChat = null;
  try {
    current.processor.disconnect();
  } catch {}
  try {
    current.source.disconnect();
  } catch {}
  current.stream.getTracks().forEach((track) => track.stop());
  current.audioContext.close();
  if (closeSocket && current.socket.readyState === WebSocket.OPEN) current.socket.close();
  finishLiveBubbles();
  if (current.started) {
    state.chatCredits = 0;
  }
  state.chatOpen = false;
  saveState();
  els.voiceChatHint.textContent = message || "打开后直接说话，我会边听边回答。";
  setStatus(message);
  renderCoach();
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
  state.chatCredits = 0;
  state.chatDialogId = null;
  state.chatHistory = [];
  state.items = state.items.map((item) => ({ ...item, completed: false, lastResult: null, sentenceRevealed: false }));
  saveState();
  renderPractice();
  showView("practice");
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
  setStatus(state.currentBatchId ? "正在编辑当前词表。" : "正在编辑新的手动词表。");
}

function startNewBatch() {
  state = {
    ...freshState(),
    view: "review",
    items: []
  };
  lastRenderedIndex = -1;
  addWordRow();
  showView("review");
  setStatus("已新建手动词表。");
}

function startPractice() {
  state.items = state.items
    .filter((item) => item.word.trim() && item.pinyin.trim())
    .map((item, index) => ({
      ...item,
      number: index + 1,
      pinyin: normalizePinyinText(item.pinyin),
      displayPinyin: normalizePinyinText(item.displayPinyin || item.pinyin)
    }));

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
els.adminToggleButton.addEventListener("click", toggleParentKidMode);
els.manualButton.addEventListener("click", startManualEntry);
els.newBatchButton.addEventListener("click", startNewBatch);
els.personaInput.addEventListener("input", () => {
  settings.personaPrompt = els.personaInput.value.trim() || defaultCoachPersona;
  saveSettings();
});
els.avatarInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    settings.avatarDataUrl = await imageFileToAvatarDataUrl(file);
    saveSettings();
    renderSettings();
    renderCoach();
    setStatus("头像已更新。");
  } catch (error) {
    setStatus(error.message || "头像没有换成功。");
  } finally {
    els.avatarInput.value = "";
  }
});
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
els.voiceChatButton.addEventListener("click", startRealtimeChat);
els.sentenceButton.addEventListener("click", () => {
  const item = getCurrentItem();
  if (item) revealSentence(item);
});
els.replaySentenceButton.addEventListener("click", replaySentence);
els.nextButton.addEventListener("click", nextWord);
els.againButton.addEventListener("click", restartPractice);
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
  renderSettings();
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
