"use client";

import { useRef, useState } from "react";

type Props = { src: string; candidateName: string };
type PlaybackState = "loading" | "buffering" | "ready" | "ended" | "error";

const stateLabel: Record<PlaybackState, string> = {
  loading: "Loading recording",
  buffering: "Buffering",
  ready: "Ready to play",
  ended: "Playback complete",
  error: "Playback unavailable"
};

export default function RecordingPlayer({ src, candidateName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PlaybackState>("loading");
  const [fullscreenMessage, setFullscreenMessage] = useState("");

  const retry = () => {
    setState("loading");
    setFullscreenMessage("");
    setAttempt(value => value + 1);
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    setFullscreenMessage("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await video.parentElement?.requestFullscreen();
    } catch {
      // Fullscreen support is independent of media playback availability.
      setFullscreenMessage("Full screen is not available in this browser.");
    }
  };

  const isWaiting = state === "loading" || state === "buffering";

  return (
    <section className="recording-player" aria-label="Candidate interview recording">
      <div className="recording-player-heading">
        <div>
          <span className="recording-player-kicker">INTERVIEW RECORDING</span>
          <h3>{candidateName}</h3>
        </div>
        <span
          className={"recording-state " + (state === "ready" || state === "ended" ? "is-ready" : state === "buffering" ? "is-buffering" : state === "error" ? "is-error" : "")}
          role="status"
          aria-live="polite"
        >
          <i aria-hidden="true" /> {stateLabel[state]}
        </span>
      </div>
      <div className="recording-player-stage">
        <video
          key={attempt}
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          aria-label={"Interview recording for " + candidateName}
          src={src}
          onLoadStart={() => setState("loading")}
          onCanPlay={() => setState("ready")}
          onPlaying={() => setState("ready")}
          onWaiting={() => setState("buffering")}
          onStalled={() => setState("buffering")}
          onEnded={() => setState("ended")}
          onError={() => setState("error")}
        />
        {isWaiting && (
          <div className="recording-player-overlay" role="status" aria-live="polite">
            <span className="recording-spinner" aria-hidden="true" />
            <b>{state === "buffering" ? "Buffering secure playback…" : "Preparing secure playback…"}</b>
            <small>{state === "buffering" ? "The video is temporarily waiting for more data." : "The recording is streamed from private storage."}</small>
          </div>
        )}
        {state === "error" && (
          <div className="recording-player-overlay recording-player-error" role="alert">
            <b>We couldn’t load this recording.</b>
            <small>Your employer session may have expired, or the recording may no longer be available.</small>
            <button type="button" onClick={retry}>Try again</button>
          </div>
        )}
      </div>
      <div className="recording-player-footer">
        <span>Private employer playback{fullscreenMessage ? " · " + fullscreenMessage : ""}</span>
        <button type="button" onClick={toggleFullscreen} aria-label="Toggle recording full screen">⛶ Full screen</button>
      </div>
    </section>
  );
}
