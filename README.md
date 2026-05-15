# Chinese Vocab Hero

A mobile-friendly Chinese vocabulary practice app for kids ages 6-10.

The app starts with a worksheet photo, extracts the numbered Chinese words and pinyin, lets a parent review the result, then gives the child a speak-aloud drill. After every try, it reveals a silly Mandarin sentence starring Superman, Spider-Man, Transformers, Nezha, or Pikachu, shows pinyin, and reads the sentence aloud.

## Why These Providers

The voice is the hardest part. The app supports **Azure Speech** and **火山引擎 / 豆包 TTS** for text-to-speech.

Azure Speech is still the tone-control winner because it supports SSML phoneme hints for `zh-CN` using pinyin tone numbers like `chang 2` and `zhang 3`, which is exactly what we need for homophones such as 长. 火山/豆包 can be a practical alternative if Azure setup is blocked, but this implementation does not have a confirmed pinyin phoneme-hint path for 火山, so heteronym control depends more on sentence context.

Anthropic handles the parts where language understanding matters: reading the worksheet photo and generating the silly sentence. If you also add an OpenAI API key, the app can use OpenAI for server-side speech transcription; otherwise it uses the browser's built-in Chinese speech recognition.

For the full photo-to-practice flow, you need:

- One Anthropic API key
- One TTS provider: Azure Speech, or 火山引擎 / 豆包 TTS

No Google Cloud project, no custom search engine, no image API, no browser scraping.

OpenAI is optional. If you only have a ChatGPT/OAuth login and no OpenAI API key, leave `OPENAI_API_KEY` blank.

## What Is Saved Locally

The browser stores the extracted words, corrected pinyin, generated sentences, and progress in `localStorage` on the same device. Press the round reset button in the top right to clear it.

API keys stay in your local `.env` file. They are never sent to the browser.

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
4. Copy the app's **AppID**.
5. Copy the app's **Access Token**.
6. Find the **cluster** and **voice_type** shown in the TTS API examples.

The common cluster is `volcano_tts`. Voice names vary by account and product version, so use a voice type shown in your console if the default below fails.

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
VOLCENGINE_TTS_ACCESS_TOKEN=
VOLCENGINE_TTS_CLUSTER=volcano_tts
VOLCENGINE_TTS_VOICE_TYPE=zh_female_wanqudashu_moon_bigtts

HTTPS_PROXY=
NO_PROXY=localhost,127.0.0.1

PORT=4173
```

To force 火山 instead of Azure:

```bash
TTS_PROVIDER=volcengine
VOLCENGINE_TTS_APP_ID=your_app_id
VOLCENGINE_TTS_ACCESS_TOKEN=your_access_token
VOLCENGINE_TTS_CLUSTER=volcano_tts
VOLCENGINE_TTS_VOICE_TYPE=your_voice_type
```

To force Azure:

```bash
TTS_PROVIDER=azure
```

If `TTS_PROVIDER` is blank, the app tries 火山 first when 火山 credentials are present, otherwise Azure.

### 6. Run the app

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

## Daily Use

1. Upload a clear photo of the worksheet if `ANTHROPIC_API_KEY` is set.
2. Or tap **手动输入** if you want to type a short list yourself.
3. Check every word and pinyin before starting.
4. Tap **听一遍** if the kid wants to hear the word.
5. Tap **按下录音**, say the word, then tap again to stop.
6. The app fuzzy-matches the transcription and always reveals a sentence.
7. Tap **下一个** to continue.

## Notes On Tone Accuracy

With Azure, the app sends pinyin hints as SSML phonemes for the target vocabulary word. For example:

```xml
<phoneme alphabet="sapi" ph="chang 2">长</phoneme>
```

For full sentences on Azure, the app wraps the target word with that hint and lets the surrounding Chinese sentence provide natural context.

With 火山/豆包, the app currently sends plain Chinese text. It may sound natural, but exact single-character heteronym control is weaker than Azure because this implementation does not pass pinyin as a phoneme hint.

The speech matching is intentionally forgiving. It checks whether the transcription contains the expected Chinese word, with a little wiggle room for multi-character words. It is meant to keep practice moving, not grade a child like a formal pronunciation exam.

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
- For 火山, check `VOLCENGINE_TTS_APP_ID`, `VOLCENGINE_TTS_ACCESS_TOKEN`, `VOLCENGINE_TTS_CLUSTER`, and `VOLCENGINE_TTS_VOICE_TYPE`.
- If 火山 says the voice is invalid, copy a voice type from your 火山 console examples.

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
