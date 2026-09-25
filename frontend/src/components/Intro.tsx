import { useEffect, useRef, useState } from "react";

/** Full-screen opening video, shown on every page load; fades into the dashboard when it ends or is skipped. */
export function Intro() {
  const [phase, setPhase] = useState<"play" | "fade" | "done">("play");
  const video = useRef<HTMLVideoElement>(null);
  const finish = () => setPhase((p) => (p === "play" ? "fade" : p));

  useEffect(() => {
    // Safety net: never keep the dashboard hidden if the video cannot play.
    const t = window.setTimeout(finish, 20000);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(); };
    window.addEventListener("keydown", key);
    video.current?.play().catch(finish);
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); };
  }, []);
  // No page scrollbar behind the video.
  useEffect(() => {
    document.documentElement.classList.toggle("intro-on", phase !== "done");
    return () => document.documentElement.classList.remove("intro-on");
  }, [phase]);
  useEffect(() => {
    if (phase !== "fade") return;
    const t = window.setTimeout(() => setPhase("done"), 600);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;
  return (
    <div className={`intro${phase === "fade" ? " out" : ""}`} onClick={finish}>
      <video ref={video} src="/opening.mp4" autoPlay muted playsInline onEnded={finish} onError={finish} />
      <button className="intro-skip" onClick={(e) => { e.stopPropagation(); finish(); }}>Lewati ›</button>
    </div>
  );
}
