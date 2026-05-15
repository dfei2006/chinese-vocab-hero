# Chinese Vocab Hero

A mobile-friendly Chinese vocabulary practice app for kids ages 6-10.

The app starts with a worksheet photo, extracts the numbered Chinese words and pinyin, lets a parent review the result, then gives the child a speak-aloud drill. After every try, it reveals a silly Mandarin sentence starring Superman, Spider-Man, Transformers, Nezha, or Pikachu, shows pinyin, and reads the sentence aloud.

## Why These Providers

The voice is the hardest part, so this app uses **Azure Speech** for text-to-speech. Azure supports SSML phoneme hints for `zh-CN` using pinyin tone numbers like `chang 2` and `zhang 3`, which is exactly what we need for homophones such as 长.

OpenAI handles the parts where language understanding matters: reading the worksheet photo, generating the silly sentence, and transcribing the kid's recording for fuzzy matching.

That means you need:

- One OpenAI API key
- One Azure Speech key, plus the Azure region printed next to that key

No Google Cloud project, no custom search engine, no image API, no browser scraping.

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

### 2. Get an OpenAI API key

1. Go to [OpenAI API keys](https://platform.openai.com/api-keys).
2. Sign in.
3. Create a new secret key.
4. Copy it once. It will look like `sk-...`.

OpenAI's API uses the key as a bearer token for requests.

### 3. Get an Azure Speech key

1. Go to [Azure AI Speech](https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices).
2. Create a Speech resource.
3. Open the resource after Azure finishes creating it.
4. Go to **Keys and Endpoint**.
5. Copy **KEY 1**.
6. Copy the **Location/Region** value, such as `eastus`.

Use a Speech resource, not the old Edge browser TTS workaround.

### 4. Create your `.env` file

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` and fill it in:

```bash
OPENAI_API_KEY=sk-your-openai-key
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe

AZURE_SPEECH_KEY=your-azure-speech-key
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoMultilingualNeural

PORT=4173
```

The default Azure voice is a natural Mandarin neural voice. You can swap it for another `zh-CN` neural voice later, but start here first.

### 5. Run the app

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

1. Upload a clear photo of the worksheet.
2. Check every word and pinyin before starting.
3. Tap **听一遍** if the kid wants to hear the word.
4. Tap **按下录音**, say the word, then tap again to stop.
5. The app fuzzy-matches the transcription and always reveals a sentence.
6. Tap **下一个** to continue.

## Notes On Tone Accuracy

The app sends pinyin hints to Azure Speech as SSML phonemes for the target vocabulary word. For example:

```xml
<phoneme alphabet="sapi" ph="chang 2">长</phoneme>
```

For full sentences, the app wraps the target word with that hint and lets the surrounding Chinese sentence provide natural context.

The speech matching is intentionally forgiving. It checks whether OpenAI's transcription contains the expected Chinese word, with a little wiggle room for multi-character words. It is meant to keep practice moving, not grade a child like a formal pronunciation exam.

## Troubleshooting

If worksheet upload fails:

- Check `OPENAI_API_KEY`.
- Make sure the photo is readable and not too dark.
- Try again with the list filling more of the picture.

If audio fails:

- Check `AZURE_SPEECH_KEY`.
- Check `AZURE_SPEECH_REGION`.
- Make sure the region is the short value such as `eastus`, not a full endpoint URL.

If recording fails:

- Allow microphone access in the browser.
- Use Chrome or Safari on mobile.
- Try `localhost` first before testing from a phone.

For more detailed server errors while debugging:

```bash
NODE_ENV=development npm start
```

## Official Docs

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/compact?api-mode=responses)
- [OpenAI speech-to-text guide](https://platform.openai.com/docs/guides/speech-to-text)
- [Azure Speech text-to-speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)
- [Azure Speech phonetic alphabets](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-ssml-phonetic-sets)

