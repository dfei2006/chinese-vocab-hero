const storageKey = "chinese-vocab-hero-state-v1";
const heroes = ["Superman", "Spider-Man", "Transformers", "Nezha", "Pikachu"];

const els = {
  statusStrip: document.querySelector("#statusStrip"),
  resetButton: document.querySelector("#resetButton"),
  photoInput: document.querySelector("#photoInput"),
  manualButton: document.querySelector("#manualButton"),
  uploadView: document.querySelector("#uploadView"),
  reviewView: document.querySelector("#reviewView"),
  practiceView: document.querySelector("#practiceView"),
  doneView: document.querySelector("#doneView"),
  wordList: document.querySelector("#wordList"),
  addWordButton: document.querySelector("#addWordButton"),
  startButton: document.querySelector("#startButton"),
  progressLabel: document.querySelector("#progressLabel"),
  scorePill: document.querySelector("#scorePill"),
  currentWord: document.querySelector("#currentWord"),
  currentPinyin: document.querySelector("#currentPinyin"),
  heroPicker: document.querySelector("#heroPicker"),
  listenWordButton: document.querySelector("#listenWordButton"),
  recordButton: document.querySelector("#recordButton"),
  feedbackBox: document.querySelector("#feedbackBox"),
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
let selectedHero = state.selectedHero || heroes[0];
let activeAudioUrl = null;
let mediaRecorder = null;
let recordingChunks = [];
let capabilities = {
  openAiConfigured: false,
  azureConfigured: false
};

function freshState() {
  return {
    view: "upload",
    items: [],
    currentIndex: 0,
    correct: 0,
    attempts: 0,
    selectedHero: heroes[0]
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

function saveState() {
  state.selectedHero = selectedHero;
  localStorage.setItem(storageKey, JSON.stringify(state));
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
    capabilities = { openAiConfigured: false, azureConfigured: false };
  }
}

async function imageFileToDataUrl(file) {
  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const image = new Image();
  image.src = rawDataUrl;
  await image.decode();

  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function handlePhotoChange(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    if (!capabilities.openAiConfigured) {
      throw new Error("照片识别需要 OpenAI API key。现在可以先点“手动输入”。");
    }
    setStatus("正在读照片...");
    const imageDataUrl = await imageFileToDataUrl(file);
    const result = await apiJson("/api/ocr", { imageDataUrl });
    state.items = result.items.map((item, index) => ({
      ...item,
      number: index + 1,
      sentence: null,
      completed: false,
      lastResult: null
    }));
    state.currentIndex = 0;
    state.correct = 0;
    state.attempts = 0;
    saveState();
    renderReview();
    showView("review");
    setStatus(`找到 ${state.items.length} 个词。`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    event.target.value = "";
  }
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

function renderHeroes() {
  els.heroPicker.innerHTML = "";
  heroes.forEach((hero) => {
    const button = document.createElement("button");
    button.className = `hero-chip ${hero === selectedHero ? "active" : ""}`;
    button.type = "button";
    button.textContent = hero;
    button.addEventListener("click", () => {
      selectedHero = hero;
      saveState();
      renderHeroes();
    });
    els.heroPicker.append(button);
  });
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

  els.progressLabel.textContent = `${state.currentIndex + 1} / ${state.items.length}`;
  els.scorePill.textContent = `${state.correct} ✓`;
  els.currentWord.textContent = item.word || "字";
  els.currentPinyin.textContent = item.displayPinyin || item.pinyin || "";
  els.feedbackBox.textContent = item.lastResult ? resultText(item.lastResult) : "";
  els.feedbackBox.className = `feedback ${item.lastResult?.ok ? "good" : item.lastResult ? "try" : ""}`;
  renderSentence(item);
  renderHeroes();
  saveState();
}

function resultText(result) {
  if (result.ok) return `好！我听到：${result.transcript}`;
  return `差一点。我听到：${result.transcript || "没听清"}`;
}

function renderSentence(item) {
  if (!item.sentence) {
    els.sentencePanel.classList.add("hidden");
    els.nextButton.classList.add("hidden");
    return;
  }

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
  state.attempts += 1;
  if (ok) state.correct += 1;
  renderPractice();
  await revealSentence(item);
}

async function revealSentence(item) {
  if (!item.sentence) {
    setStatus("正在召唤英雄句子...");
    item.sentence = capabilities.openAiConfigured
      ? await apiJson("/api/sentence", {
          word: item.word,
          pinyin: item.pinyin,
          hero: selectedHero
        })
      : makeLocalSentence(item);
    saveState();
    renderPractice();
  }
  await playSentence(item);
}

function makeLocalSentence(item) {
  const hero = selectedHero;
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

function nextWord() {
  state.currentIndex += 1;
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
  state.items = state.items.map((item) => ({ ...item, completed: false, lastResult: null }));
  saveState();
  renderPractice();
  showView("practice");
}

function resetAll() {
  localStorage.removeItem(storageKey);
  state = freshState();
  selectedHero = heroes[0];
  renderHeroes();
  showView("upload");
  setStatus(capabilities.openAiConfigured ? "" : "没有 OpenAI API key：照片识别先不可用，但可以手动输入练习。");
}

function addWordRow() {
  state.items.push({
    id: crypto.randomUUID(),
    number: state.items.length + 1,
    word: "",
    pinyin: "",
    displayPinyin: "",
    sentence: null,
    completed: false,
    lastResult: null
  });
  saveState();
  renderReview();
}

function startManualEntry() {
  if (!state.items.length) addWordRow();
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
els.replaySentenceButton.addEventListener("click", replaySentence);
els.nextButton.addEventListener("click", nextWord);
els.againButton.addEventListener("click", restartPractice);
els.resetButton.addEventListener("click", resetAll);

async function init() {
  await refreshCapabilities();
  renderHeroes();
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
    if (!capabilities.openAiConfigured) {
      setStatus("没有 OpenAI API key：照片识别先不可用，但可以手动输入练习。");
    }
  }
}

await init();
