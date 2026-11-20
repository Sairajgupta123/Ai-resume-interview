"use client";

import { useRef, useState } from "react";

type Props = { src: string; candidateName: string };

export default function RecordingPlayer({ src, candidateName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const retry = () => {
    setState("loading");
    setAttempt(value => value + 1);
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await video.parentElement?.requestFullscreen();
    } catch {
      setState("error");
    }
  };

  return (
    <section className="recording-player" aria-label="Candidate interview recording">
      <div className="recording-player-heading">
        <div>
          <span className="recording-player-kicker">INTERVIEW RECORDING</span>
          <h3>{candidateName}</h3>
        </div>
        <span className={"recording-state " + (state === "ready" ? "is-ready" : state === "error" ? "is-error" : "")}>
          <i /> {state === "ready" ? "Ready to play" : state === "error" ? "Playback unavailable" : "Loading recording"}
        </span>
      </div>
      <div className="recording-player-stage">
        <video
          key={attempt}
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload"
          disablePictureInPicture
          aria-label={"Interview recording for " + candidateName}
          src={src}
          onLoadStart={() => setState("loading")}
          onLoadedMetadata={() => setState("ready")}
          onCanPlay={() => setState("ready")}
          onError={() => setState("error")}
        />
        {state === "loading" && <div className="recording-player-overlay"><span className="recording-spinner" /><b>Preparing secure playback…</b><small>The recording is streamed from private storage.</small></div>}
        {state === "error" && <div className="recording-player-overlay recording-player-error"><b>We couldn’t load this recording.</b><small>Your session may have expired, or the recording may no longer be available.</small><button type="button" onClick={retry}>Try again</button></div>}
      </div>
      <div className="recording-player-footer">
        <span>Private employer playback</span>
        <button type="button" onClick={toggleFullscreen}>⛶ Full screen</button>
      </div>
    </section>
  );
}
