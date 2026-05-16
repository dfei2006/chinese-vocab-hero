# Chinese Vocab Hero

A mobile-friendly Chinese vocabulary practice app for kids ages 6-10.

The app starts with a worksheet photo, extracts the numbered Chinese words and pinyin, lets a parent review the result, then gives the child a speak-aloud drill. After every try, it reveals a silly Mandarin sentence starring Superman, Spider-Man, Transformers, Nezha, or Pikachu, shows pinyin, and reads the sentence aloud.

## Why These Providers

The voice is the hardest part. The app supports **Azure Speech** and **火山引擎 / 豆包 TTS** for text-to-speech, and it can use **火山端到端实时语音大模型** for the unlocked live voice chat reward.

Azure Speech is still the tone-control winner because it supports SSML phoneme hints for `zh-CN` using pinyin tone numbers like `chang 2` and `zhang 3`, which is exactly what we need for homophones such as 长. 火山/豆包 can be a practical alternative if Azure setup is blocked, but this implementation does not have a confirmed pinyin phoneme-hint path for 火山, so heteronym control depends more on sentence context.

Anthropic handles the parts where language understanding matters: reading the worksheet photo and generating the silly sentence. If you also add an OpenAI API key, the app can use OpenAI for server-side speech transcription; otherwise it uses the browser's built-in Chinese speech recognition.

For the full photo-to-practice flow, you need:

- One Anthropic API key
- One TTS provider: Azure Speech, or 火山引擎 / 豆包 TTS

For the live voice chat reward, use one 火山 realtime API key from the 豆包端到端实时语音大模型 API access page.

No Google Cloud project, no custom search engine, no image API, no browser scraping.

OpenAI is optional. If you only have a ChatGPT/OAuth login and no OpenAI API key, leave `OPENAI_API_KEY` blank.

## What Is Saved Locally

The browser stores the extracted words, corrected pinyin, generated sentences, coach persona, coach avatar, chat transcript, and progress in `localStorage` on the same device.

API keys stay on the server: in your local `.env` file for local use, or in your hosting provider's private environment variables for internet deployment. They are never sent to the browser.

## Setup

### 1. Install Node

Install Node.js 20 or newer:

```bash
node --version
```

If that prints `v20` or higher, you are good.

### 2. Get an Anthropic API key

1. Go to [Anthropic Console API keys](https://console.anthropic.com/settings/keys).
2. Sign in.
3. Create a key.
4. Copy it once.

The app uses this one key for worksheet photo OCR and sentence generation.

### 3. Optional: Get an OpenAI API key

1. Go to [OpenAI API keys](https://platform.openai.com/api-keys).
2. Sign in.
3. Create a new secret key.
4. Copy it once. It will look like `sk-...`.

OpenAI is only used for server-side speech transcription. Without it, the app uses browser speech recognition.

Your ChatGPT/OAuth login is not the same thing as an API key. If you do not have an OpenAI API key, leave `OPENAI_API_KEY` blank.

### 4. Choose a TTS Provider

#### Option A: Azure Speech

1. Go to [Azure AI Speech](https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices).
2. Create a Speech resource.
3. Open the resource after Azure finishes creating it.
4. Go to **Keys and Endpoint**.
5. Copy **KEY 1**.
6. Copy the **Location/Region** value, such as `eastus`.

Use a Speech resource, not the old Edge browser TTS workaround.

#### Option B: 火山引擎 / 豆包 TTS

1. Go to the 火山引擎控制台.
2. Open the speech/语音合成 product.
3. Create or open an app.
4. Copy the app's **APP ID**.
5. In the left sidebar, open **API访问密钥** and create/copy an **API Key**.
6. Use the resource ID for the model. For a cloned/custom `S_...` voice like this app's coach voice, use `seed-icl-2.0`. For a standard built-in Seed TTS voice, use `seed-tts-2.0`.
7. Find the **voice_type** / **speaker** shown in the TTS API examples.

The newer console uses API Key access with the `X-Api-Key` header. The old console used Access Token. The app supports both, but the API Key path is the one to use on the screen you showed.

### 5. Create your `.env` file

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` and fill it in:

```bash
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe

ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-sonnet-4-20250514

AZURE_SPEECH_KEY=your-azure-speech-key
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoMultilingualNeural

TTS_PROVIDER=
VOLCENGINE_TTS_APP_ID=
VOLCENGINE_TTS_ACCESS_KEY=
VOLCENGINE_TTS_RESOURCE_ID=seed-icl-2.0
VOLCENGINE_TTS_ACCESS_TOKEN=
VOLCENGINE_TTS_CLUSTER=volcano_tts
VOLCENGINE_TTS_VOICE_TYPE=S_nNepq2X22

VOLCENGINE_REALTIME_APP_ID=
VOLCENGINE_REALTIME_ACCESS_TOKEN=
VOLCENGINE_REALTIME_ACCESS_KEY=
VOLCENGINE_REALTIME_SPEAKER=S_nNepq2X22

HTTPS_PROXY=
NO_PROXY=localhost,127.0.0.1

PORT=4173
```

To force 火山 instead of Azure:

```bash
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_APP_ID=your_app_id
VOLCENGINE_TTS_ACCESS_KEY=your_api_key
VOLCENGINE_TTS_RESOURCE_ID=seed-icl-2.0
VOLCENGINE_TTS_VOICE_TYPE=S_nNepq2X22
```

For the unlocked live voice chat, fill these from the 火山 **豆包端到端实时语音大模型** API access page:

```bash
VOLCENGINE_REALTIME_APP_ID=your_realtime_app_id
VOLCENGINE_REALTIME_ACCESS_TOKEN=your_realtime_access_token
VOLCENGINE_REALTIME_SPEAKER=S_nNepq2X22
```

`VOLCENGINE_REALTIME_ACCESS_KEY` is also accepted as an alias, but the app prefers `VOLCENGINE_REALTIME_ACCESS_TOKEN` for realtime because the WebSocket doc describes `X-Api-Access-Key` as the console Access Token. `VOLCENGINE_REALTIME_SPEAKER` can be the same cloned voice ID you use for TTS, as long as that voice is available to the realtime model. If `VOLCENGINE_REALTIME_APP_ID` is blank, the app reuses `VOLCENGINE_TTS_APP_ID` for the realtime `X-Api-App-ID` header.

To force Azure:

```bash
TTS_PROVIDER=azure
```

If `TTS_PROVIDER` is blank, the app tries 火山 first when 火山 credentials are present, otherwise Azure.

### 6. Run the app

Install the one local WebSocket dependency:

```bash
npm install
```

Then start:

```bash
npm start
```

Open:

[http://localhost:4173](http://localhost:4173)

For phone testing on the same Wi-Fi, find your computer's local IP address and open:

```text
http://YOUR-COMPUTER-IP:4173
```

Browsers usually allow the microphone on `localhost`. On a phone, you may need to allow microphone permission when prompted.

## Deploy On The Internet

The app is a single Node web service. It serves the pages, API routes, and realtime WebSocket from the same domain. That is important because microphone access needs HTTPS on the public internet, and same-domain WebSockets are simpler.

The easiest deployment path is Render:

1. Push this project to a private GitHub repository.
2. Go to [Render](https://render.com).
3. Click **New +**.
4. Choose **Blueprint**.
5. Connect the GitHub repo.
6. Render will read `render.yaml`.
7. When Render asks for secret environment variables, paste the same values from your local `.env`.

The included `render.yaml` uses Render's free web service plan so you can test without choosing a paid plan first. If the app feels slow to wake up, upgrade that service in Render later.

Use these required variables:

```text
ANTHROPIC_API_KEY
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_APP_ID
VOLCENGINE_TTS_ACCESS_KEY or VOLCENGINE_TTS_ACCESS_TOKEN
VOLCENGINE_TTS_RESOURCE_ID=seed-icl-2.0
VOLCENGINE_TTS_VOICE_TYPE
VOLCENGINE_REALTIME_APP_ID
VOLCENGINE_REALTIME_ACCESS_TOKEN
VOLCENGINE_REALTIME_SPEAKER
```

Leave `PORT` alone on Render. Render provides it automatically.

After deploy, open the Render URL on your phone. It should look like:

```text
https://your-app-name.onrender.com
```

Use `https://`, not plain `http://`, so the browser will allow microphone access.

If you do not use Render, choose any host that supports:

- Node 20+
- `npm ci`
- `npm start`
- WebSockets
- HTTPS
- private environment variables

## Daily Use

1. Upload a clear photo of the worksheet if `ANTHROPIC_API_KEY` is set.
2. Each photo upload creates a new saved词表. It will not replace the active one.
3. Or tap **手动输入** to edit/add to the current词表. Tap **新建词表** to start a separate manual list.
4. Pick an old list under **以前的词语表**, or tap **从头练** on that list to restart it.
5. Check every word and pinyin before starting.
6. Tap **听一遍** if the kid wants to hear the word.
7. Tap **按下录音**, say the word, then tap again to stop.
8. The app checks the transcription and always reveals a sentence.
9. After 3 correct words, the coach card lights up. Tap the coach card to start live voice chat.
10. Tap **下一个** to continue.

The top-right button toggles between parent/admin mode and the kid practice interface.

## Notes On Tone Accuracy

With Azure, the app sends pinyin hints as SSML phonemes for the target vocabulary word. For example:

```xml
<phoneme alphabet="sapi" ph="chang 2">长</phoneme>
```

For full sentences on Azure, the app wraps the target word with that hint and lets the surrounding Chinese sentence provide natural context.

With 火山/豆包, the app currently sends plain Chinese text. It may sound natural, but exact single-character heteronym control is weaker than Azure because this implementation does not pass pinyin as a phoneme hint.

The speech matching is intentionally light, but no longer accepts partial-word matches. For example, saying only `表` should not pass for `一块表`. For longer words, the app allows a tiny one-character transcription wobble so practice does not get stuck on speech-recognition noise.

## Troubleshooting

If worksheet upload fails:

- Check `ANTHROPIC_API_KEY`.
- If you do not want to use an OCR provider, use **手动输入** instead.
- Make sure the photo is readable and not too dark.
- Try again with the list filling more of the picture.

If you see `Cannot reach Anthropic from this network` while your VPN is on:

- Your browser may be using the VPN, but Node may not be.
- Open your VPN app and look for an HTTP proxy, mixed proxy, or local proxy address.
- Put that address in `.env` as `HTTPS_PROXY`.
- Common examples are `HTTPS_PROXY=http://127.0.0.1:7890`, `HTTPS_PROXY=http://127.0.0.1:6152`, or `HTTPS_PROXY=http://127.0.0.1:8080`.
- Restart with `npm start` after editing `.env`.

If pronunciation checking says your browser cannot listen:

- Try Chrome or Safari.
- Make sure microphone access is allowed.
- Add an OpenAI API key if you want server-side transcription instead of browser speech recognition.

If audio fails:

- Check `TTS_PROVIDER`.
- For Azure, check `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
- For 火山 API Key mode, check `VOLCENGINE_TTS_APP_ID`, `VOLCENGINE_TTS_ACCESS_KEY`, `VOLCENGINE_TTS_RESOURCE_ID=seed-icl-2.0`, and `VOLCENGINE_TTS_VOICE_TYPE=S_nNepq2X22` for the cloned coach voice.
- If 火山 says the voice is invalid or mismatched, the voice type and resource ID do not belong to the same model grant.

If live voice chat says 火山 rejected the connection or shows `401`:

- Check `VOLCENGINE_REALTIME_APP_ID`.
- Check `VOLCENGINE_REALTIME_ACCESS_TOKEN`.
- Make sure the key is from the **豆包端到端实时语音大模型** API access flow, not only the normal TTS page.
- The realtime API uses the fixed resource grant `volc.speech.dialog`; the app/key must have that access.

If recording fails:

- Allow microphone access in the browser.
- Use Chrome or Safari on mobile.
- Try `localhost` first before testing from a phone.

For more detailed server errors while debugging:

```bash
NODE_ENV=development npm start
```

## Official Docs

- [Anthropic API overview](https://docs.anthropic.com/en/api/overview)
- [Anthropic Messages examples](https://docs.anthropic.com/en/api/messages-examples)
- [Anthropic vision guide](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/compact?api-mode=responses)
- [OpenAI speech-to-text guide](https://platform.openai.com/docs/guides/speech-to-text)
- [Azure Speech text-to-speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)
- [Azure Speech phonetic alphabets](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-ssml-phonetic-sets)
- [火山引擎语音合成文档](https://www.volcengine.com/docs/6561)
- [火山端到端实时语音大模型调用指南](https://www.volcengine.com/docs/6561/1594356?lang=zh)
