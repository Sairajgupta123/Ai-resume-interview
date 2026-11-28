# xAI Grok Realtime integration notes

## Current browser connection flow

1. The candidate must have a valid invitation session, consent, a started live interview and an unexpired interview window.
2. The browser requests `POST /api/sessions/{id}/voice-session`. The server validates the candidate and interview state, applies the per-interview/IP attempt limit, and requests a 60-second ephemeral secret from `POST https://api.x.ai/v1/realtime/client_secrets`.
3. The server returns only the ephemeral token. The permanent `XAI_API_KEY` remains server-side.
4. The browser opens `wss://api.x.ai/v1/realtime?model=grok-voice-latest` using the `xai-client-secret.<token>` WebSocket subprotocol.
5. The client waits for both the WebSocket `open` event and xAI's `session.created` event. Either may arrive first. Transient initialization failures retry with a fresh token, up to three attempts.
6. The browser sends `session.update` with the interview instructions, `eve` voice, server VAD, `grok-transcribe` input transcription and 24 kHz PCM input/output.
7. The browser waits for `session.updated` before starting the audio graph. The scripted opening question is sent as a `force_message`; it is a TTS-synthesized assistant line and does not need a separate `response.create`.
8. Microphone frames are resampled to signed PCM16 at 24 kHz and sent as base64 `input_audio_buffer.append` events. Assistant PCM chunks are queued for playback. Persist the final candidate transcript from `conversation.item.input_audio_transcription.completed` and the final assistant transcript from `response.output_audio_transcript.done`. xAI's `conversation.item.input_audio_transcription.updated` event is cumulative interim caption text; do not persist every update as a separate transcript turn.

## Required manual staging checks

- Use a synthetic candidate and a valid xAI account with Realtime access.
- Confirm the browser WebSocket request contains the `xai-client-secret.` subprotocol and never contains the permanent API key.
- Confirm the server returns an ephemeral secret with an expiry and the browser can connect before it expires.
- Confirm `session.created` and `open` both arrive; exercise the two event orders if using a network fault proxy.
- Confirm `session.updated` arrives after the configuration request and before microphone audio is sent.
- Confirm the scripted opening line plays once, is interruptible, and is not duplicated in the saved transcript.
- Confirm microphone audio reaches the service, speech VAD ends turns, assistant audio plays, and both final transcripts are saved once.
- Test mute/unmute, microphone removal, candidate interruption, network loss, reconnect, provider error and the three-attempt limit.
- Confirm the candidate can continue using text input if voice setup fails.

## Protocol references

- [xAI Voice API reference](https://docs.x.ai/developers/rest-api-reference/inference/voice)
- [xAI Speech to Speech guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech)
- [xAI Ephemeral Tokens guide](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens)

The Realtime client follows the documented ephemeral-token WebSocket subprotocol and the documented `session.created`, `session.update`, `session.updated`, audio-buffer and transcript events. The `force_message` event is an xAI-specific extension for scripted TTS lines. Keep the manual staging checks open until a real authorized browser session has passed; unit tests cannot verify provider-side account access, network behavior or microphone/audio device behavior.
