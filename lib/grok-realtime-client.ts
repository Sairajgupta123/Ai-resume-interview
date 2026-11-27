import {
  base64Pcm16ToFloat32,
  pcm16ToBase64,
  resampleFloat32ToPcm16
} from "@/lib/grok-voice-audio.mjs";
import { waitForRealtimeSession } from "@/lib/realtime-handshake.mjs";

type TranscriptRole = "user" | "assistant";

type GrokRealtimeCallbacks = {
  onTranscript: (role: TranscriptRole, text: string) => void;
  onStatus?: (status: "connecting" | "connected" | "closed") => void;
  onMicrophoneState?: (state: "muted" | "live") => void;
  onError?: (message: string) => void;
};

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
};

const REALTIME_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
const SAMPLE_RATE = 24_000;

const normalizeTranscript = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

export class GrokRealtimeClient {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private playbackCursor = 0;
  private playbackSources = new Set<AudioBufferSourceNode>();
  private closed = false;
  private callbacks: GrokRealtimeCallbacks;
  private sessionId: string;
  private stream: MediaStream;
  private audioTrack: MediaStreamTrack | null = null;
  private readonly onMicrophoneEnded = () => {
    if (!this.closed) this.callbacks.onError?.("The microphone stopped. Reconnect your microphone or continue by typing.");
  };
  private readonly onMicrophoneMute = () => {
    if (!this.closed) this.callbacks.onMicrophoneState?.("muted");
  };
  private readonly onMicrophoneUnmute = () => {
    if (!this.closed) this.callbacks.onMicrophoneState?.("live");
  };
  private instructions: string;
  private initialMessage: string;
  private openingTranscriptPending = true;

  constructor(args: {
    sessionId: string;
    stream: MediaStream;
    instructions: string;
    initialMessage: string;
    callbacks: GrokRealtimeCallbacks;
  }) {
    this.sessionId = args.sessionId;
    this.stream = args.stream;
    this.instructions = args.instructions;
    this.initialMessage = args.initialMessage;
    this.openingTranscriptPending = Boolean(args.initialMessage.trim());
    this.callbacks = args.callbacks;
  }

  async connect() {
    if (this.socket) throw new Error("Grok voice is already initialized.");
    this.closed = false;
    this.callbacks.onStatus?.("connecting");

    let socket: WebSocket | null = null;
    let lastConnectionError: Error | null = null;

    // Retry transient provider handshakes with a fresh short-lived token.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.closed) return;
      const tokenResponse = await fetch(`/api/sessions/${encodeURIComponent(this.sessionId)}/voice-session`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || typeof tokenData.token !== "string") {
        throw new Error(tokenData.error || "Could not obtain a secure AI voice session.");
      }
      if (this.closed) return;

      const attemptSocket = new WebSocket(REALTIME_URL, [`xai-client-secret.${tokenData.token}`]);
      this.socket = attemptSocket;
      try {
        await waitForRealtimeSession(attemptSocket, 15_000);
        socket = attemptSocket;
        break;
      } catch (error) {
        attemptSocket.close();
        if (this.socket === attemptSocket) this.socket = null;
        lastConnectionError = error instanceof Error ? error : new Error("Could not connect to the AI voice service.");
        if (this.closed) return;
        if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 300 * (attempt + 1)));
      }
    }

    if (!socket) throw lastConnectionError || new Error("Could not initialize the AI voice connection.");

    if (this.closed) {
      socket.close();
      return;
    }

    socket.addEventListener("message", event => this.handleMessage(event));
    socket.addEventListener("close", () => {
      this.stopAudioGraph();
      this.callbacks.onStatus?.("closed");
      if (!this.closed) this.callbacks.onError?.("The AI voice connection was closed. You can continue by typing.");
    });
    socket.addEventListener("error", () => {
      if (!this.closed) this.callbacks.onError?.("The AI voice connection encountered an error.");
    });

    try {
      this.audioContext = new AudioContext();
      await this.audioContext.resume();
      const sessionReady = new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          window.clearTimeout(timeout);
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("close", onClose);
        };
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error("AI voice session setup timed out."));
        }, 10_000);
        const onClose = () => {
          cleanup();
          reject(new Error("AI voice connection closed during session setup."));
        };
        const onMessage = (message: MessageEvent) => {
          try {
            const payload = JSON.parse(String(message.data)) as RealtimeEvent;
            if (payload.type === "session.updated") {
              cleanup();
              resolve();
            } else if (payload.type === "error") {
              cleanup();
              reject(new Error(payload.error?.message || "AI voice session setup failed."));
            }
          } catch { /* ignore non-JSON events */ }
        };
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", onClose, { once: true });
      });
      socket.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: this.instructions,
          voice: "eve",
          turn_detection: { type: "server_vad" },
          audio: {
            input: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              transcription: { model: "grok-transcribe", language_hint: "en" }
            },
            output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } }
          }
        }
      }));
      await sessionReady;
      if (this.closed) return;
      this.startAudioGraph();
      if (this.initialMessage.trim()) {
        socket.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "force_message",
            role: "assistant",
            interruptible: true,
            content: [{ type: "output_text", text: this.initialMessage }]
          }
        }));
      }
      this.callbacks.onStatus?.("connected");
  
    } catch (error) {
      this.stopAudioGraph();
      if (socket.readyState < WebSocket.CLOSING) socket.close();
      this.socket = null;
      throw error;
    }
  }

  private startAudioGraph() {
    const audioContext = this.audioContext;
    if (!audioContext) throw new Error("Audio output is not initialized.");
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live") {
      throw new Error("A live microphone track is required for AI voice.");
    }
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    this.audioTrack = audioTrack;
    audioTrack.addEventListener("ended", this.onMicrophoneEnded, { once: true });
    audioTrack.addEventListener("mute", this.onMicrophoneMute);
    audioTrack.addEventListener("unmute", this.onMicrophoneUnmute);
    if (audioTrack.muted) this.onMicrophoneMute();
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = event => {
      const socket = this.socket;
      if (this.closed || audioTrack.muted || !audioTrack.enabled || !socket || socket.readyState !== WebSocket.OPEN) return;
      const pcm = resampleFloat32ToPcm16(
        event.inputBuffer.getChannelData(0),
        audioContext.sampleRate,
        SAMPLE_RATE
      );
      if (pcm.length === 0) return;
      socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16ToBase64(pcm) }));
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    this.inputSource = source;
    this.processor = processor;
    this.silentGain = silentGain;
  }

  private handleMessage(event: MessageEvent) {
    let data: RealtimeEvent;
    try {
      data = JSON.parse(String(event.data)) as RealtimeEvent;
    } catch {
      return;
    }
    if (data.type === "error") {
      this.callbacks.onError?.(data.error?.message || "The AI voice service returned an error.");
      return;
    }

    if (data.type === "conversation.item.input_audio_transcription.completed" && data.transcript?.trim()) {
      this.callbacks.onTranscript("user", data.transcript.trim());
      return;
    }
    if (data.type === "response.output_audio_transcript.done" && data.transcript?.trim()) {
      const transcript = data.transcript.trim();
      if (this.openingTranscriptPending && normalizeTranscript(transcript) === normalizeTranscript(this.initialMessage)) {
        this.openingTranscriptPending = false;
        return;
      }
      this.openingTranscriptPending = false;
      this.callbacks.onTranscript("assistant", transcript);
      return;
    }
    if (data.type === "input_audio_buffer.speech_started") {
      this.stopPlayback();
      return;
    }
    if (data.type === "response.output_audio.delta" && data.delta) {
      this.queueAudio(data.delta);
    }
  }

  private queueAudio(base64: string) {
    const audioContext = this.audioContext;
    if (!audioContext) return;
    try {
      const samples = base64Pcm16ToFloat32(base64);
      if (samples.length === 0) return;
      const buffer = audioContext.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      const startAt = Math.max(audioContext.currentTime + 0.02, this.playbackCursor);
      this.playbackCursor = startAt + buffer.duration;
      this.playbackSources.add(source);
      source.onended = () => this.playbackSources.delete(source);
      source.start(startAt);
    } catch {
      this.callbacks.onError?.("The AI voice service returned an invalid audio chunk.");
    }
  }

  private stopPlayback() {
    for (const source of this.playbackSources) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.playbackSources.clear();
    this.playbackCursor = this.audioContext?.currentTime || 0;
  }

  private stopAudioGraph() {
    this.audioTrack?.removeEventListener("ended", this.onMicrophoneEnded);
    this.audioTrack?.removeEventListener("mute", this.onMicrophoneMute);
    this.audioTrack?.removeEventListener("unmute", this.onMicrophoneUnmute);
    this.audioTrack = null;
    this.processor?.disconnect();
    this.inputSource?.disconnect();
    this.silentGain?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor = null;
    this.inputSource = null;
    this.silentGain = null;
    this.stopPlayback();
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }

  close() {
    this.closed = true;
    this.stopAudioGraph();
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.socket = null;
    this.callbacks.onStatus?.("closed");
  }
}
