import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = normalize(join(__dirname, ".."));
const publicDir = join(rootDir, "public");

await loadEnvFile(join(rootDir, ".env"));

const port = Number(process.env.PORT || 4173);
const openAiTextModel = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
const openAiTranscribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const azureVoice = process.env.AZURE_SPEECH_VOICE || "zh-CN-XiaoxiaoMultilingualNeural";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (process.env[key]) continue;
    process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const readable = name
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/^\w/, (letter) => letter.toUpperCase());
    throw new UserError(`${readable} is not configured yet.`);
  }
  return value;
}

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function extractOutputText(responseJson) {
  if (responseJson.output_text) return responseJson.output_text;

  const parts = [];
  for (const item of responseJson.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
      if (content.type === "text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseJsonText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The model returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return JSON.");
    return JSON.parse(match[0]);
  }
}

async function callOpenAiResponses(payload) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responseJson.error?.message || "OpenAI request failed.");
  }

  return parseJsonText(extractOutputText(responseJson));
}

async function handleOcr(req, res) {
  const { imageDataUrl } = await readJson(req);
  if (!imageDataUrl?.startsWith("data:image/")) {
    throw new UserError("Upload a worksheet photo first.");
  }

  const prompt = `
You extract Chinese vocabulary worksheet items for a child.
The photo should contain a numbered list of Chinese words and may contain pinyin.
Return only JSON with this shape:
{
  "items": [
    {
      "number": 1,
      "word": "长",
      "pinyin": "chang2",
      "displayPinyin": "cháng"
    }
  ]
}
Rules:
- Extract every numbered vocabulary word in order.
- "word" should contain only the target Chinese word or phrase, not the number.
- "pinyin" must be lowercase, syllable-spaced, and use tone numbers 1-5, for example "zhang3" or "peng2 you3".
- If the worksheet pinyin is visible, use it exactly for the tones.
- If pinyin is missing, infer the most likely school vocabulary reading from context.
- "displayPinyin" should use tone marks and spaces.
- Do not include translations, explanations, markdown, or commentary.
`.trim();

  const result = await callOpenAiResponses({
    model: openAiTextModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl }
        ]
      }
    ]
  });

  const items = Array.isArray(result.items) ? result.items : [];
  sendJson(res, 200, {
    items: items
      .filter((item) => item.word && item.pinyin)
      .map((item, index) => ({
        id: crypto.randomUUID(),
        number: Number(item.number || index + 1),
        word: String(item.word).trim(),
        pinyin: String(item.pinyin).trim(),
        displayPinyin: String(item.displayPinyin || item.pinyin).trim()
      }))
  });
}

async function handleSentence(req, res) {
  const { word, pinyin, hero } = await readJson(req);
  if (!word || !pinyin) throw new UserError("Choose a vocabulary word first.");

  const allowedHeroes = ["Superman", "Spider-Man", "Transformers", "Nezha", "Pikachu"];
  const chosenHero = allowedHeroes.includes(hero) ? hero : allowedHeroes[Math.floor(Math.random() * allowedHeroes.length)];

  const prompt = `
Create one short, silly Mandarin sentence for a 6-10 year old.
Vocabulary word: ${word}
Vocabulary pinyin: ${pinyin}
Hero: ${chosenHero}

Return only JSON with this shape:
{
  "hero": "Nezha",
  "sentence": "哪吒把长长的面条当成了风火轮。",
  "pinyin": "Né zhā bǎ cháng cháng de miàn tiáo dàng chéng le fēng huǒ lún.",
  "english": "Nezha used long noodles as his wind-fire wheels."
}

Rules:
- The sentence must be natural Mandarin Chinese and must contain the exact vocabulary word.
- Keep it under 18 Chinese characters when possible.
- Make it playful, never mean or scary.
- Use the vocabulary reading implied by the pinyin.
- Pinyin must match the sentence.
`.trim();

  const result = await callOpenAiResponses({
    model: openAiTextModel,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  });

  sendJson(res, 200, {
    hero: chosenHero,
    sentence: String(result.sentence || "").trim(),
    pinyin: String(result.pinyin || "").trim(),
    english: String(result.english || "").trim()
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const toneMarks = new Map([
  ["ā", ["a", 1]], ["á", ["a", 2]], ["ǎ", ["a", 3]], ["à", ["a", 4]],
  ["ē", ["e", 1]], ["é", ["e", 2]], ["ě", ["e", 3]], ["è", ["e", 4]],
  ["ī", ["i", 1]], ["í", ["i", 2]], ["ǐ", ["i", 3]], ["ì", ["i", 4]],
  ["ō", ["o", 1]], ["ó", ["o", 2]], ["ǒ", ["o", 3]], ["ò", ["o", 4]],
  ["ū", ["u", 1]], ["ú", ["u", 2]], ["ǔ", ["u", 3]], ["ù", ["u", 4]],
  ["ǖ", ["v", 1]], ["ǘ", ["v", 2]], ["ǚ", ["v", 3]], ["ǜ", ["v", 4]],
  ["ü", ["v", 5]]
]);

function pinyinToSapi(pinyin) {
  const syllables = String(pinyin)
    .toLowerCase()
    .replace(/u:/g, "v")
    .replace(/ü/g, "v")
    .split(/[\s'.,;:!?，。！？、-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const numbered = part.match(/^([a-zv]+)([1-5])$/);
      if (numbered) return `${numbered[1]} ${numbered[2]}`;

      let base = "";
      let tone = 5;
      for (const char of part) {
        const marked = toneMarks.get(char);
        if (marked) {
          base += marked[0];
          tone = marked[1];
        } else if (/[a-zv]/.test(char)) {
          base += char;
        }
      }
      return base ? `${base} ${tone}` : "";
    })
    .filter(Boolean);

  return syllables.join(" - ");
}

function phonemeTag(text, pinyin) {
  const sapi = pinyinToSapi(pinyin);
  if (!sapi) return escapeXml(text);
  return `<phoneme alphabet="sapi" ph="${escapeXml(sapi)}">${escapeXml(text)}</phoneme>`;
}

function buildSsml({ text, word, pinyin, mode }) {
  const escapedVoice = escapeXml(azureVoice);
  let body = escapeXml(text);

  if (mode === "word") {
    body = phonemeTag(text, pinyin);
  } else if (word && pinyin && text.includes(word)) {
    body = escapeXml(text).replace(escapeXml(word), phonemeTag(word, pinyin));
  }

  return `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${escapedVoice}">
    <prosody rate="-5%" pitch="+2%">${body}</prosody>
  </voice>
</speak>`.trim();
}

async function handleTts(req, res) {
  const { text, word, pinyin, mode } = await readJson(req, 512 * 1024);
  if (!text) throw new UserError("There is no text to read aloud.");

  const key = requireEnv("AZURE_SPEECH_KEY");
  const region = requireEnv("AZURE_SPEECH_REGION");
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSsml({ text, word, pinyin, mode });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "ChineseVocabHero"
    },
    body: ssml
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(details || "Azure Speech request failed.");
  }

  const audio = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, {
    "content-type": "audio/mpeg",
    "cache-control": "no-store"
  });
  res.end(audio);
}

async function handleTranscribe(req, res) {
  const { audioDataUrl } = await readJson(req, 15 * 1024 * 1024);
  const match = String(audioDataUrl || "").match(/^data:(audio\/[^;]+);base64,(.+)$/);
  if (!match) throw new UserError("Record a pronunciation first.");

  const apiKey = requireEnv("OPENAI_API_KEY");
  const mimeType = match[1];
  const audioBuffer = Buffer.from(match[2], "base64");
  const form = new FormData();
  form.set("model", openAiTranscribeModel);
  form.set("language", "zh");
  form.set("prompt", "A child is reading one Mandarin Chinese vocabulary word or short phrase. Return the Chinese characters only.");
  form.set("file", new Blob([audioBuffer], { type: mimeType }), `recording.${mimeType.includes("mp4") ? "mp4" : "webm"}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form
  });

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responseJson.error?.message || "OpenAI transcription failed.");
  }

  sendJson(res, 200, { text: String(responseJson.text || "").trim() });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      azureConfigured: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
      azureVoice
    });
    return;
  }

  if (req.method !== "POST") throw new UserError("Use POST for this API route.", 405);

  if (url.pathname === "/api/ocr") return handleOcr(req, res);
  if (url.pathname === "/api/sentence") return handleSentence(req, res);
  if (url.pathname === "/api/tts") return handleTts(req, res);
  if (url.pathname === "/api/transcribe") return handleTranscribe(req, res);

  throw new UserError("API route not found.", 404);
}

async function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalizedPath = normalize(join(publicDir, requestedPath));

  if (!normalizedPath.startsWith(publicDir) || !existsSync(normalizedPath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const body = await readFile(normalizedPath);
  res.writeHead(200, {
    "content-type": mimeTypes[extname(normalizedPath)] || "application/octet-stream"
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
    } else {
      await sendStatic(req, res);
    }
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, {
      error: error instanceof UserError ? error.message : "Something went wrong.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

server.listen(port, () => {
  console.log(`Chinese Vocab Hero running at http://localhost:${port}`);
});
