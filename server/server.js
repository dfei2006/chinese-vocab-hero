import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = normalize(join(__dirname, ".."));
const publicDir = join(rootDir, "public");

await loadEnvFile(join(rootDir, ".env"));

const port = Number(process.env.PORT || 4173);
const openAiTextModel = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
const openAiTranscribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const anthropicModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const azureVoice = process.env.AZURE_SPEECH_VOICE || "zh-CN-XiaoxiaoMultilingualNeural";
const volcengineVoice = process.env.VOLCENGINE_TTS_VOICE_TYPE || "zh_female_shuangkuaisisi_uranus_bigtts";
const realtimeAccessToken = process.env.VOLCENGINE_REALTIME_ACCESS_TOKEN || process.env.VOLCENGINE_REALTIME_ACCESS_KEY;
const realtimeAppId = process.env.VOLCENGINE_REALTIME_APP_ID || process.env.VOLCENGINE_TTS_APP_ID;
const realtimeAppIdSource = process.env.VOLCENGINE_REALTIME_APP_ID ? "realtime" : process.env.VOLCENGINE_TTS_APP_ID ? "tts" : "";
const realtimeSpeaker = process.env.VOLCENGINE_REALTIME_SPEAKER || volcengineVoice;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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

function normalizePinyinText(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

async function callOpenAiResponses(payload) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new UserError("Cannot reach OpenAI from this network. Check your connection or VPN.", 502);
  }

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new UserError(responseJson.error?.message || "OpenAI request failed.", response.status);
  }

  return parseJsonText(extractOutputText(responseJson));
}

async function callOpenAiText(prompt, maxTokens = 500) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: openAiTextModel,
        max_output_tokens: maxTokens,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
      })
    });
  } catch {
    throw new UserError("Cannot reach OpenAI from this network. Check your connection or VPN.", 502);
  }

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new UserError(responseJson.error?.message || "OpenAI request failed.", response.status);
  }

  return extractOutputText(responseJson).trim();
}

function extractAnthropicText(responseJson) {
  return (responseJson.content || [])
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
}

function extractAnthropicToolInput(responseJson) {
  for (const part of responseJson.content || []) {
    if (part.type === "tool_use" && part.name === "return_json" && part.input) {
      return part.input;
    }
  }
  return null;
}

async function callAnthropicMessages(payload, { parseJson = true } = {}) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new UserError("Cannot reach Anthropic from this network. Check your connection or VPN, or use manual entry.", 502);
  }

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new UserError(responseJson.error?.message || "Anthropic request failed.", response.status);
  }

  const toolInput = extractAnthropicToolInput(responseJson);
  if (toolInput) return toolInput;
  if (!parseJson) return responseJson;

  try {
    return parseJsonText(extractAnthropicText(responseJson));
  } catch {
    throw new UserError("Anthropic returned an unreadable worksheet result. Try a clearer photo or use manual entry.", 502);
  }
}

async function callLanguageText({ prompt, maxTokens = 500 }) {
  const provider = preferredLanguageProvider();

  if (provider === "anthropic") {
    const responseJson = await callAnthropicMessages({
      model: anthropicModel,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
    }, { parseJson: false });
    return extractAnthropicText(responseJson).trim();
  }

  if (provider === "openai") return callOpenAiText(prompt, maxTokens);

  throw new UserError("Add ANTHROPIC_API_KEY or OPENAI_API_KEY for coach chat.", 400);
}

function preferredLanguageProvider() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "local";
}

async function callLanguageJson({ prompt, imageDataUrl, maxTokens = 1200, schema }) {
  const provider = preferredLanguageProvider();

  if (provider === "anthropic") {
    const content = [];
    if (imageDataUrl) {
      const match = imageDataUrl.match(/^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/);
      if (!match) throw new UserError("Use a JPEG, PNG, GIF, or WebP worksheet photo.");
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match[1] === "image/jpg" ? "image/jpeg" : match[1],
          data: match[2]
        }
      });
    }
    content.push({ type: "text", text: prompt });
    const payload = {
      model: anthropicModel,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }]
    };
    if (schema) {
      payload.tools = [
        {
          name: "return_json",
          description: "Return the requested structured result.",
          input_schema: schema
        }
      ];
      payload.tool_choice = { type: "tool", name: "return_json" };
    }
    return callAnthropicMessages(payload);
  }

  if (provider === "openai") {
    const content = [{ type: "input_text", text: prompt }];
    if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl });
    return callOpenAiResponses({
      model: openAiTextModel,
      input: [{ role: "user", content }]
    });
  }

  throw new UserError("Add ANTHROPIC_API_KEY for worksheet photos, or use manual entry.", 400);
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

  const ocrSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            number: { type: "integer" },
            word: { type: "string" },
            pinyin: { type: "string" },
            displayPinyin: { type: "string" }
          },
          required: ["number", "word", "pinyin", "displayPinyin"]
        }
      }
    },
    required: ["items"]
  };

  const result = await callLanguageJson({
    prompt,
    imageDataUrl,
    maxTokens: 4000,
    schema: ocrSchema
  });

  const items = Array.isArray(result.items) ? result.items : [];
  sendJson(res, 200, {
    items: items
      .filter((item) => item.word && item.pinyin)
      .map((item, index) => ({
        id: crypto.randomUUID(),
        number: Number(item.number || index + 1),
        word: String(item.word).trim(),
        pinyin: normalizePinyinText(item.pinyin),
        displayPinyin: normalizePinyinText(item.displayPinyin || item.pinyin)
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
- The vocabulary word must use exactly this pronunciation: ${pinyin}.
- For heteronyms, choose the meaning that matches the supplied pinyin and avoid contexts that force another reading.
- Example: if the word is 长 and the pinyin is chang2, use it to mean "long" and do not write 长得, 成长, or 校长.
- Keep it under 18 Chinese characters when possible.
- Make it playful, never mean or scary.
- Use the vocabulary reading implied by the pinyin.
- Pinyin must match the sentence and must show the target word with the supplied tone.
`.trim();

  const sentenceSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      hero: { type: "string" },
      sentence: { type: "string" },
      pinyin: { type: "string" },
      english: { type: "string" }
    },
    required: ["hero", "sentence", "pinyin", "english"]
  };

  const result = await callLanguageJson({ prompt, maxTokens: 700, schema: sentenceSchema });

  sendJson(res, 200, {
    hero: chosenHero,
    sentence: String(result.sentence || "").trim(),
    pinyin: normalizePinyinText(result.pinyin),
    english: String(result.english || "").trim()
  });
}

async function handleChat(req, res) {
  const { message, studiedItems = [], currentWord, history = [] } = await readJson(req, 512 * 1024);
  if (!message?.trim()) throw new UserError("Type a message for the coach first.");

  const vocabLines = studiedItems
    .slice(0, 30)
    .map((item, index) => `${index + 1}. ${item.word} (${item.pinyin || item.displayPinyin || ""})${item.completed ? " practiced" : ""}`)
    .join("\n");

  const recentChat = history
    .slice(-6)
    .map((turn) => `${turn.role === "kid" ? "Kid" : "Coach"}: ${turn.text}`)
    .join("\n");

  const prompt = `
You are an upbeat Mandarin "hero coach" for a 6-10 year old practicing Chinese vocabulary.
Speak in simple Mandarin Chinese, with a warm, playful coach energy.
Keep replies under 45 Chinese characters unless the kid asks for a story.
Use the vocabulary the child has studied when it fits naturally.
If correcting Chinese, be gentle and concrete.

Studied vocabulary:
${vocabLines || "None yet."}

Current word: ${currentWord?.word || "none"} (${currentWord?.pinyin || ""})

Recent chat:
${recentChat || "No chat yet."}

Kid says: ${message}

Return only the coach reply text in Mandarin Chinese.
`.trim();

  const reply = await callLanguageText({ prompt, maxTokens: 500 });
  sendJson(res, 200, { reply: reply || "好，我们继续练中文！" });
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

function preferredTtsProvider() {
  const requested = (process.env.TTS_PROVIDER || "").toLowerCase();
  if (requested) return requested;
  if (process.env.VOLCENGINE_TTS_APP_ID && (process.env.VOLCENGINE_TTS_ACCESS_KEY || process.env.VOLCENGINE_TTS_API_KEY || process.env.VOLCENGINE_TTS_ACCESS_TOKEN)) return "volcengine";
  if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) return "azure";
  return "none";
}

async function synthesizeWithAzure({ text, word, pinyin, mode }) {
  const key = requireEnv("AZURE_SPEECH_KEY");
  const region = requireEnv("AZURE_SPEECH_REGION");
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSsml({ text, word, pinyin, mode });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "ChineseVocabHero"
      },
      body: ssml
    });
  } catch {
    throw new UserError("Cannot reach Azure Speech from this network. Check your connection, VPN, region, or Speech key.", 502);
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new UserError("Azure rejected the Speech key or region. Copy KEY 1 from your Azure Speech resource and make sure AZURE_SPEECH_REGION matches that resource, for example eastus.", 401);
    }
    throw new UserError(details || "Azure Speech request failed.", response.status);
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: "audio/mpeg"
  };
}

async function synthesizeWithVolcengine({ text, resourceIdOverride, speakerOverride }) {
  const appId = requireEnv("VOLCENGINE_TTS_APP_ID");
  const accessKey = process.env.VOLCENGINE_TTS_ACCESS_KEY || process.env.VOLCENGINE_TTS_API_KEY;
  if (accessKey) return synthesizeWithVolcengineV3({ text, appId, accessKey, resourceIdOverride, speakerOverride });

  const token = requireEnv("VOLCENGINE_TTS_ACCESS_TOKEN");
  const cluster = process.env.VOLCENGINE_TTS_CLUSTER || "volcano_tts";
  const endpoint = process.env.VOLCENGINE_TTS_ENDPOINT || "https://openspeech.bytedance.com/api/v1/tts";
  const payload = {
    app: {
      appid: appId,
      token,
      cluster
    },
    user: {
      uid: process.env.VOLCENGINE_TTS_UID || "chinese-vocab-hero"
    },
    audio: {
      voice_type: volcengineVoice,
      encoding: "mp3",
      speed_ratio: 0.95,
      volume_ratio: 1,
      pitch_ratio: 1
    },
    request: {
      reqid: crypto.randomUUID(),
      text,
      text_type: "plain",
      operation: "query"
    }
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer;${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new UserError("Cannot reach Volcengine TTS from this network. Check your connection, VPN, or VOLCENGINE_TTS settings.", 502);
  }

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new UserError(responseJson.message || "Volcengine TTS request failed.", response.status);
  }

  if (responseJson.code && responseJson.code !== 3000) {
    throw new UserError(responseJson.message || `Volcengine TTS failed with code ${responseJson.code}.`, 400);
  }

  if (!responseJson.data) {
    throw new UserError("Volcengine TTS returned no audio data.", 502);
  }

  return {
    audio: Buffer.from(responseJson.data, "base64"),
    contentType: "audio/mpeg"
  };
}

function parseVolcengineV3Audio(text) {
  const chunks = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const jsonText = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!jsonText || jsonText === "[DONE]") continue;
    try {
      const event = JSON.parse(jsonText);
      const base64 = event.data || event.audio || event.result?.audio || event.result?.data;
      if (typeof base64 === "string" && base64) chunks.push(Buffer.from(base64, "base64"));
      const message = event.message || event.error?.message || event.BaseResp?.StatusMessage;
      const code = event.code ?? event.BaseResp?.StatusCode;
      if (!base64 && code && code !== 0 && code !== 3000 && code !== 20000000) {
        throw new UserError(message || `Volcengine TTS failed with code ${code}.`, 400);
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
    }
  }
  return Buffer.concat(chunks);
}

async function synthesizeWithVolcengineV3({ text, appId, accessKey, resourceIdOverride, speakerOverride }) {
  const resourceId = resourceIdOverride || process.env.VOLCENGINE_TTS_RESOURCE_ID || "seed-tts-2.0";
  const endpoint = process.env.VOLCENGINE_TTS_V3_ENDPOINT || "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
  const requestId = crypto.randomUUID();
  const useNewApiKeyAuth = Boolean(process.env.VOLCENGINE_TTS_ACCESS_KEY || process.env.VOLCENGINE_TTS_API_KEY);
  const speaker = speakerOverride || volcengineVoice;
  const payload = {
    req_params: {
      text,
      speaker,
      audio_params: {
        format: "mp3",
        sample_rate: 24000
      }
    }
  };

  let response;
  try {
    const headers = {
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": requestId,
      "content-type": "application/json"
    };
    if (useNewApiKeyAuth) {
      headers["X-Api-Key"] = accessKey;
    } else {
      headers["X-Api-App-Id"] = appId;
      headers["X-Api-Access-Key"] = accessKey;
    }

    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch {
    throw new UserError("Cannot reach Volcengine TTS V3 from this network. Check your connection, VPN, or VOLCENGINE_TTS settings.", 502);
  }

  const responseText = await response.text();
  if (!response.ok) {
    let message = responseText;
    try {
      const parsed = JSON.parse(responseText);
      message = parsed.message || parsed.error?.message || parsed.BaseResp?.StatusMessage || message;
    } catch {
      // Keep the raw message.
    }
    throw new UserError(`${message || "Volcengine TTS V3 request failed."} Resource ID: ${resourceId}.`, response.status);
  }

  const audio = parseVolcengineV3Audio(responseText);
  if (!audio.length) {
    throw new UserError(`Volcengine TTS V3 returned no audio. Resource ID: ${resourceId}. Check VOLCENGINE_TTS_RESOURCE_ID and VOLCENGINE_TTS_VOICE_TYPE.`, 502);
  }

  return {
    audio,
    contentType: "audio/mpeg"
  };
}

async function handleTts(req, res) {
  const { text, word, pinyin, mode, _testResourceId, _testSpeaker } = await readJson(req, 512 * 1024);
  if (!text) throw new UserError("There is no text to read aloud.");

  const provider = preferredTtsProvider();
  let result;
  if (provider === "azure") {
    result = await synthesizeWithAzure({ text, word, pinyin, mode });
  } else if (provider === "volcengine" || provider === "volc") {
    result = await synthesizeWithVolcengine({
      text,
      word,
      pinyin,
      mode,
      resourceIdOverride: process.env.NODE_ENV === "development" ? _testResourceId : undefined,
      speakerOverride: process.env.NODE_ENV === "development" ? _testSpeaker : undefined
    });
  } else {
    throw new UserError("No TTS provider is configured. Set TTS_PROVIDER=volcengine with Volcengine credentials, or configure Azure Speech.", 400);
  }

  res.writeHead(200, {
    "content-type": result.contentType,
    "cache-control": "no-store"
  });
  res.end(result.audio);
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

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form
    });
  } catch {
    throw new UserError("Cannot reach OpenAI transcription from this network. Use browser speech recognition or check your connection.", 502);
  }

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new UserError(responseJson.error?.message || "OpenAI transcription failed.", response.status);
  }

  sendJson(res, 200, { text: String(responseJson.text || "").trim() });
}

const VOLC_CLIENT_FULL_REQUEST = 0b0001;
const VOLC_CLIENT_AUDIO_REQUEST = 0b0010;
const VOLC_SERVER_FULL_RESPONSE = 0b1001;
const VOLC_SERVER_ACK = 0b1011;
const VOLC_SERVER_ERROR = 0b1111;
const VOLC_MSG_WITH_EVENT = 0b0100;
const VOLC_JSON = 0b0001;
const VOLC_NO_SERIALIZATION = 0b0000;
const VOLC_GZIP = 0b0001;

function volcHeader({
  messageType = VOLC_CLIENT_FULL_REQUEST,
  flags = VOLC_MSG_WITH_EVENT,
  serialization = VOLC_JSON,
  compression = VOLC_GZIP
} = {}) {
  return Buffer.from([
    (0b0001 << 4) | 0b0001,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0
  ]);
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

function volcMessage({ event, sessionId, payload = {}, messageType, serialization, compression = VOLC_GZIP }) {
  const rawPayload = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const body = compression === VOLC_GZIP ? gzipSync(rawPayload) : rawPayload;
  const parts = [
    volcHeader({ messageType, serialization, compression }),
    int32(event)
  ];
  if (sessionId) {
    const session = Buffer.from(sessionId);
    parts.push(uint32(session.length), session);
  }
  parts.push(uint32(body.length), body);
  return Buffer.concat(parts);
}

function parseVolcMessage(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const headerSize = (buffer[0] & 0x0f) * 4;
  const messageType = buffer[1] >> 4;
  const flags = buffer[1] & 0x0f;
  const serialization = buffer[2] >> 4;
  const compression = buffer[2] & 0x0f;
  let offset = headerSize;
  const result = { messageType, flags, serialization, compression };

  if (messageType === VOLC_SERVER_FULL_RESPONSE || messageType === VOLC_SERVER_ACK) {
    if (flags & 0b0010) offset += 4;
    if (flags & VOLC_MSG_WITH_EVENT) {
      result.event = buffer.readInt32BE(offset);
      offset += 4;
    }
    const sessionLength = buffer.readInt32BE(offset);
    offset += 4 + sessionLength;
    const payloadLength = buffer.readUInt32BE(offset);
    offset += 4;
    let payload = buffer.subarray(offset, offset + payloadLength);
    if (compression === VOLC_GZIP) payload = gunzipSync(payload);
    result.payload = serialization === VOLC_JSON ? JSON.parse(payload.toString("utf8")) : payload;
  } else if (messageType === VOLC_SERVER_ERROR) {
    result.code = buffer.readUInt32BE(offset);
    offset += 4;
    const payloadLength = buffer.readUInt32BE(offset);
    offset += 4;
    let payload = buffer.subarray(offset, offset + payloadLength);
    if (compression === VOLC_GZIP) payload = gunzipSync(payload);
    result.payload = payload.toString("utf8");
  }

  return result;
}

function realtimeSystemRole(context = {}) {
  const studied = Array.isArray(context.studiedItems) ? context.studiedItems : [];
  const vocabLines = studied
    .slice(0, 30)
    .map((item, index) => `${index + 1}. ${item.word} (${item.pinyin || item.displayPinyin || ""})${item.completed ? " practiced" : ""}`)
    .join("\n");
  const currentWord = context.currentWord || {};
  return `
你是成龙，正在给 6-10 岁孩子练中文。
你要用简单、自然、短句的普通话聊天，像在实时陪孩子练习。
每次回答尽量少于 35 个汉字，鼓励孩子多说中文。
自然使用孩子已经练过的词，不要考试式提问太多。

已练词语：
${vocabLines || "暂无。"}

当前词语：${currentWord.word || "无"} (${currentWord.pinyin || ""})
`.trim();
}

function realtimeStartSessionPayload(context) {
  return {
    tts: {
      audio_config: {
        channel: 1,
        format: "pcm",
        sample_rate: 24000
      },
      speaker: realtimeSpeaker
    },
    dialog: {
      bot_name: "Atlas",
      system_role: realtimeSystemRole(context),
      dialog_id: context.dialogId || crypto.randomUUID(),
      speaking_style: "说话自然、有活力，像在面对面鼓励孩子练中文。语速稍慢，句子短。",
      extra: { strict_audit: false }
    }
  };
}

async function openVolcRealtimeSocket(context) {
  if (!realtimeAppId || !realtimeAccessToken) {
    throw new UserError("Volcengine realtime voice is not configured. Set VOLCENGINE_REALTIME_APP_ID and VOLCENGINE_REALTIME_ACCESS_KEY.", 400);
  }

  const upstream = new WebSocket("wss://openspeech.bytedance.com/api/v3/realtime/dialogue", {
    headers: {
      "X-Api-App-ID": realtimeAppId,
      "X-Api-Access-Key": realtimeAccessToken,
      "X-Api-Resource-Id": "volc.speech.dialog",
      "X-Api-App-Key": "PlgvMymc7f3tQnJ6",
      "X-Api-Connect-Id": crypto.randomUUID()
    }
  });

  try {
    await new Promise((resolve, reject) => {
      upstream.once("open", resolve);
      upstream.once("error", reject);
      upstream.once("unexpected-response", (_req, res) => {
        const logId = res.headers["x-tt-logid"] || res.headers["x-tt-log-id"];
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 500) body = body.slice(0, 500);
        });
        res.on("end", () => {
          const details = [
            `HTTP ${res.statusCode}`,
            logId ? `logid ${logId}` : "",
            body.trim() ? body.trim() : ""
          ].filter(Boolean).join(" - ");
          reject(new Error(details));
        });
      });
    });
  } catch (error) {
    throw new UserError(`Volcengine realtime voice rejected the connection. Check VOLCENGINE_REALTIME_APP_ID and VOLCENGINE_REALTIME_ACCESS_KEY. ${error.message || ""}`.trim(), 502);
  }

  const sessionId = crypto.randomUUID();
  upstream.send(volcMessage({ event: 1, payload: {} }));
  await onceMessage(upstream);
  upstream.send(volcMessage({ event: 100, sessionId, payload: realtimeStartSessionPayload(context) }));
  await onceMessage(upstream);
  return { upstream, sessionId };
}

function onceMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", resolve);
    socket.once("error", reject);
  });
}

function sendClientJson(client, payload) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
}

async function startRealtimeBridge(client, context) {
  let upstream;
  let sessionId;
  try {
    ({ upstream, sessionId } = await openVolcRealtimeSocket(context));
  } catch (error) {
    sendClientJson(client, { type: "error", message: error.message || "Cannot start realtime voice chat." });
    client.close();
    return null;
  }

  sendClientJson(client, { type: "ready", sampleRate: 24000 });

  upstream.on("message", (data) => {
    try {
      const event = parseVolcMessage(data);
      if (event.messageType === VOLC_SERVER_ERROR) {
        sendClientJson(client, { type: "error", message: event.payload || `Volcengine realtime error ${event.code}` });
        return;
      }
      if (event.event === 451) {
        const result = event.payload?.results?.[0];
        const text = result?.alternatives?.[0]?.text;
        if (text) sendClientJson(client, { type: "transcript", text, final: !result.is_interim });
      } else if (event.event === 550) {
        const text = event.payload?.content;
        if (text) sendClientJson(client, { type: "replyText", text });
      } else if (event.event === 352 && Buffer.isBuffer(event.payload)) {
        sendClientJson(client, { type: "audio", sampleRate: 24000, data: event.payload.toString("base64") });
      } else if (event.event === 359) {
        sendClientJson(client, { type: "replyDone" });
      }
    } catch (error) {
      sendClientJson(client, { type: "error", message: error.message || "Could not read realtime response." });
    }
  });

  upstream.on("close", () => client.close());
  upstream.on("error", (error) => sendClientJson(client, { type: "error", message: error.message || "Volcengine realtime socket failed." }));
  return { upstream, sessionId };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      languageProvider: preferredLanguageProvider(),
      azureConfigured: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
      azureVoice,
      volcengineConfigured: Boolean(process.env.VOLCENGINE_TTS_APP_ID && (process.env.VOLCENGINE_TTS_ACCESS_KEY || process.env.VOLCENGINE_TTS_API_KEY || process.env.VOLCENGINE_TTS_ACCESS_TOKEN)),
      volcengineRealtimeConfigured: Boolean(realtimeAppId && realtimeAccessToken),
      volcengineRealtimeAppIdSource: realtimeAppIdSource,
      volcengineRealtimeMissing: {
        appId: !realtimeAppId,
        accessKey: !realtimeAccessToken
      },
      volcengineVoice,
      realtimeSpeaker,
      ttsProvider: preferredTtsProvider()
    });
    return;
  }

  if (req.method !== "POST") throw new UserError("Use POST for this API route.", 405);

  if (url.pathname === "/api/ocr") return handleOcr(req, res);
  if (url.pathname === "/api/sentence") return handleSentence(req, res);
  if (url.pathname === "/api/chat") return handleChat(req, res);
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

const realtimeWss = new WebSocketServer({ noServer: true });

realtimeWss.on("connection", (client) => {
  let bridge = null;

  client.on("message", async (data, isBinary) => {
    if (isBinary) {
      if (bridge?.upstream?.readyState === WebSocket.OPEN) {
        bridge.upstream.send(volcMessage({
          event: 200,
          sessionId: bridge.sessionId,
          payload: Buffer.from(data),
          messageType: VOLC_CLIENT_AUDIO_REQUEST,
          serialization: VOLC_NO_SERIALIZATION
        }));
      }
      return;
    }

    let message = {};
    try {
      message = JSON.parse(String(data));
    } catch {
      sendClientJson(client, { type: "error", message: "Bad realtime control message." });
      return;
    }

    if (message.type === "start" && !bridge) {
      bridge = await startRealtimeBridge(client, message.context || {});
    }
  });

  client.on("close", () => {
    if (bridge?.upstream?.readyState === WebSocket.OPEN) bridge.upstream.close();
  });
});

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

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/realtime") {
    socket.destroy();
    return;
  }

  realtimeWss.handleUpgrade(req, socket, head, (ws) => {
    realtimeWss.emit("connection", ws, req);
  });
});

server.listen(port, () => {
  console.log(`Chinese Vocab Hero running at http://localhost:${port}`);
});
