import {
  base64Pcm16ToFloat32,
  pcm16ToBase64,
  resampleFloat32ToPcm16
} from "@/lib/grok-voice-audio.mjs";

type TranscriptRole = "user" | "assistant";

type GrokRealtimeCallbacks = {
  onTranscript: (role: TranscriptRole, text: string) => void;
  onStatus?: (status: "connecting" | "connected" | "closed") => void;
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
  private instructions: string;

  constructor(args: {
    sessionId: string;
    stream: MediaStream;
    instructions: string;
    callbacks: GrokRealtimeCallbacks;
  }) {
    this.sessionId = args.sessionId;
    this.stream = args.stream;
    this.instructions = args.instructions;
    this.callbacks = args.callbacks;
  }

  async connect() {
    if (this.socket) throw new Error("Grok voice is already initialized.");
    this.closed = false;
    this.callbacks.onStatus?.("connecting");

    const tokenResponse = await fetch(`/api/sessions/${encodeURIComponent(this.sessionId)}/voice-session`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store"
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokenData.token !== "string") {
      throw new Error(tokenData.error || "Could not obtain a secure AI voice session.");
    }
    if (this.closed) return;

    const socket = new WebSocket(REALTIME_URL, [`xai-client-secret.${tokenData.token}`]);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("AI voice connection timed out.")), 15_000);
      socket.addEventListener("open", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not connect to the AI voice service."));
      }, { once: true });
    });

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

    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    this.socket.send(JSON.stringify({
      type: "session.update",
      session: {
        instructions: this.instructions,
        voice: "eve",
        turn_detection: { type: "server_vad" },
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "grok-2-audio" }
      }
    }));
    this.startAudioGraph();
    this.callbacks.onStatus?.("connected");
  }

  private startAudioGraph() {
    if (!this.audioContext) throw new Error("Audio output is not initialized.");
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== "live") {
      throw new Error("A live microphone track is required for AI voice.");
    }
    const source = this.audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = event => {
      if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
      const pcm = resampleFloat32ToPcm16(
        event.inputBuffer.getChannelData(0),
        this.audioContext!.sampleRate,
        SAMPLE_RATE
      );
      if (pcm.length === 0) return;
      this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16ToBase64(pcm) }));
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
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
      this.callbacks.onTranscript("assistant", data.transcript.trim());
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
    if (!this.audioContext) return;
    const samples = base64Pcm16ToFloat32(base64);
    if (samples.length === 0) return;
    const buffer = this.audioContext.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const startAt = Math.max(this.audioContext.currentTime + 0.02, this.playbackCursor);
    this.playbackCursor = startAt + buffer.duration;
    this.playbackSources.add(source);
    source.onended = () => this.playbackSources.delete(source);
    source.start(startAt);
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
