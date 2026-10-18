"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, AudioWaveform, FileImage, FileJson, Github, LoaderCircle, Maximize2, Pause, Play, RefreshCw, RotateCcw, ScanLine, Settings2, Sparkles, Upload, Waves, X } from "lucide-react";
import { calculateFourier, FourierTerm, fourierEnergyError, Point, reconstruct } from "@/lib/fourier";
import { extractRasterContour, extractSvgContour, makeDemoContour } from "@/lib/contours";

type Settings = { terms: number; speed: number; circles: boolean; vectors: boolean; source: boolean; trail: boolean; threshold: number; invert: boolean };
const DEFAULT: Settings = { terms: 96, speed: 1, circles: true, vectors: true, source: false, trail: true, threshold: 150, invert: false };
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef({ ...DEFAULT, playing: true });
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [terms, setTerms] = useState<FourierTerm[]>([]);
  const [sourcePoints, setSourcePoints] = useState<Point[]>([]);
  const [fileName, setFileName] = useState("Heart study");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState("00:00");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mobileControls, setMobileControls] = useState(false);
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const visibleTerms = useMemo(() => terms.slice(0, settings.terms), [terms, settings.terms]);
  const reconstructed = useMemo(() => terms.length ? reconstruct(terms, settings.terms, 1024) : [], [terms, settings.terms]);
  const errorValue = useMemo(() => terms.length ? fourierEnergyError(terms, settings.terms) : 0, [terms, settings.terms]);
  const maxTerms = Math.max(8, terms.length);

  useEffect(() => { stateRef.current = { ...settings, playing }; }, [settings, playing]);

  const processFile = useCallback(async (file: File) => {
    setError("");
    if (file.size > MAX_FILE_BYTES) { setError("Please choose an image under 20 MB."); return; }
    const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!isSvg && !["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"].includes(file.type)) {
      setError("Unsupported file type. Please use SVG, PNG, JPG, WEBP, GIF, or BMP."); return;
    }
    setBusy(true); setProgress(8);
    try {
      const points = isSvg
        ? await extractSvgContour(file)
        : await extractRasterContour(file, { threshold: settings.threshold, invert: settings.invert });
      setProgress(48);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const coefficients = calculateFourier(points, 2048);
      setProgress(100);
      setSourcePoints(points);
      setTerms(coefficients);
      setFileName(file.name.replace(/\.[^.]+$/, ""));
      setPlaying(true);
      setSourceImageUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
      setShowAdvanced(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The image could not be processed.");
    } finally {
      window.setTimeout(() => { setBusy(false); setProgress(0); }, 200);
    }
  }, [settings.threshold, settings.invert]);

  const loadDemo = useCallback(() => {
    const points = makeDemoContour();
    setSourcePoints(points);
    setTerms(calculateFourier(points, 2048));
    setFileName("Heart study"); setError(""); setPlaying(true);
    setSourceImageUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return ""; });
  }, []);

  useEffect(() => { loadDemo(); }, [loadDemo]);
  useEffect(() => () => { if (sourceImageUrl) URL.revokeObjectURL(sourceImageUrl); }, [sourceImageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terms.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = 1, height = 1, dpr = 1, last = performance.now(), t = 0, elapsedSecond = -1;
    const trail: Point[] = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const frame = (now: number) => {
      const state = stateRef.current;
      const dt = Math.min(40, now - last); last = now;
      if (state.playing) t = (t + dt * 0.000055 * state.speed) % 1;
      ctx.clearRect(0, 0, width, height);
      const centreX = width / 2, centreY = height / 2;
      const sumAmplitude = visibleTerms.reduce((sum, term) => sum + term.amplitude, 0) || 1;
      const scale = Math.min((Math.min(width, height) * 0.42) / sumAmplitude, 1.8);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.035)";
      ctx.lineWidth = 1;
      for (let x = centreX % 32; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (let y = centreY % 32; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      ctx.restore();

      let x = centreX, y = centreY;
      const chain: Array<{ x: number; y: number; radius: number; term: FourierTerm }> = [];
      for (const term of visibleTerms) {
        chain.push({ x, y, radius: term.amplitude * scale, term });
        const angle = 2 * Math.PI * term.frequency * t + term.phase;
        x += term.amplitude * Math.cos(angle) * scale;
        y -= term.amplitude * Math.sin(angle) * scale;
      }
      for (const item of chain) {
        const angle = 2 * Math.PI * item.term.frequency * t + item.term.phase;
        const nx = item.x + Math.cos(angle) * item.radius;
        const ny = item.y - Math.sin(angle) * item.radius;
        if (state.circles && item.radius > 1.5) {
          ctx.beginPath(); ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(196,205,215," + (0.07 + Math.min(0.13, item.radius / 500)) + ")";
          ctx.lineWidth = 0.85; ctx.stroke();
        }
        if (state.vectors) {
          ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(nx, ny);
          ctx.strokeStyle = "rgba(233,238,242,.42)"; ctx.lineWidth = 1; ctx.stroke();
        }
      }
      const endpoint = { x, y };
      if (state.playing) trail.push(endpoint);
      if (trail.length > 7000) trail.splice(0, trail.length - 7000);
      if (state.trail && trail.length > 1) {
        ctx.beginPath(); ctx.moveTo(trail[0].x, trail[0].y);
        for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
        ctx.strokeStyle = "#f0b18f"; ctx.lineWidth = 1.65; ctx.lineJoin = "round"; ctx.stroke();
      }
      if (state.source && sourcePoints.length > 2) {
        ctx.beginPath();
        sourcePoints.forEach((p, i) => {
          const sx = centreX + (p.x - 0.5) * Math.min(width, height) * 0.8;
          const sy = centreY + (p.y - 0.5) * Math.min(width, height) * 0.8;
          if (!i) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        });
        ctx.closePath(); ctx.strokeStyle = "rgba(111,190,174,.40)"; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(endpoint.x, endpoint.y, 3.2, 0, Math.PI * 2); ctx.fillStyle = "#f0b18f"; ctx.fill();
      const seconds = Math.floor(now / 1000);
      if (seconds !== elapsedSecond) {
        elapsedSecond = seconds;
        const s = seconds % 60, m = Math.floor(seconds / 60) % 60;
        setElapsed(String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0"));
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
    return () => { if (animationRef.current !== null) cancelAnimationFrame(animationRef.current); observer.disconnect(); };
  }, [terms, visibleTerms, sourcePoints]);

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((old) => ({ ...old, [key]: value }));
  const resetAnimation = () => { setPlaying(false); window.setTimeout(() => setPlaying(true), 40); };
  const exportCoefficients = () => {
    const payload = { file: fileName, transform: "complex Fourier series", terms: visibleTerms, errorMetric: "normalized RMS positional error (%)", normalizedRmsErrorPercent: Number(errorValue.toFixed(4)) };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), safeName(fileName) + "-fourier.json");
  };
  const exportSvg = () => {
    const points = reconstruct(terms, settings.terms, 1800);
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
    const coords = points.map((p) => ((p.x - minX) / w * 920 + 40).toFixed(2) + "," + (960 - (p.y - minY) / h * 920 - 20).toFixed(2)).join(" ");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#080a0d"/><polyline points="' + coords + '" fill="none" stroke="#f0b18f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), safeName(fileName) + "-trace.svg");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Fourier Studio home"><span className="brand-mark"><AudioWaveform size={21}/></span><span>FOURIER<span className="brand-muted"> / STUDIO</span></span></a>
        <nav className="top-nav"><a href="#workspace">Workspace</a><a href="#how-it-works">How it works</a><a href="https://github.com/Yazito21/image-fourier" target="_blank" rel="noreferrer" className="github-link"><Github size={15}/> Source code <span className="external-arrow">↗</span></a></nav>
        <div className="private-pill"><span className="green-dot"/> Runs locally</div>
      </header>

      <section className="hero" id="home">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> MATHEMATICS, IN MOTION <span className="eyebrow-dot">✳</span></div><h1>Every curve has<br/>a <span>frequency.</span></h1><p>Turn an image into a Fourier series. Watch rotating circles find their way around every line.</p><div className="hero-actions"><button className="primary-button" onClick={() => fileInputRef.current?.click()}><Upload size={16}/> Upload an image <span className="button-arrow">↗</span></button><button className="quiet-button" onClick={loadDemo}><Sparkles size={15}/> Try the demo</button></div><div className="hero-footnote"><span className="mini-shield">⌘</span> Private by design <span className="foot-sep">/</span> No API keys <span className="foot-sep">/</span> No sign-up</div></div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit orbit-c"/><div className="orbit-core">ƒ<span>t</span></div><div className="art-cross cross-a"/><div className="art-cross cross-b"/><svg className="art-path" viewBox="0 0 460 330" fill="none"><path d="M82 199 C82 165 113 142 145 158 C166 167 171 191 194 194 C229 201 225 151 264 146 C313 140 325 191 356 184 C396 176 387 110 349 99 C318 90 304 119 281 119 C241 119 252 75 211 67 C166 58 145 96 157 128 C169 160 211 155 228 184 C253 226 213 259 171 247 C128 235 127 207 82 199Z" stroke="#F1B18F" strokeWidth="1.4"/><path d="M82 199 L194 194 L264 146 L356 184" stroke="rgba(241,177,143,.34)" strokeDasharray="3 6"/></svg><div className="art-ring-label label-a">2π · 0.5</div><div className="art-ring-label label-b">FREQUENCY / 04</div><div className="art-caption"><span className="live-dot"/> 2D COMPLEX PLANE <span>·</span> n → ∞</div></div>
      </section>

      <section id="workspace" className="workspace-section">
        <div className="section-heading"><div><div className="eyebrow small"><span className="eyebrow-line"/> THE WORKSPACE</div><h2>From pixels to <span>pure motion.</span></h2></div><div className="workspace-index"><span className="index-current">01</span><span className="index-slash">/</span> 01 <span className="index-line"/></div></div>
        <div className="workspace-grid">
          <aside className={"control-panel " + (mobileControls ? "panel-open" : "")}>
            <button className="mobile-panel-toggle" onClick={() => setMobileControls((v) => !v)}><Settings2 size={16}/> Controls <span/><span>⌄</span></button>
            <div className="panel-top"><div><span className="panel-kicker">PROJECT</span><h3>{fileName}</h3></div><button className="icon-button" title="Load demo" onClick={loadDemo}><RefreshCw size={15}/></button></div>
            <div className="panel-divider"/>
            <div className={"upload-zone " + (dragging ? "drag-active" : "")} onDragOver={(e) => {e.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <div className="upload-icon"><FileImage size={21}/></div><strong>Drop your image here</strong><span>SVG, PNG, JPG, WEBP · Up to 20 MB</span><button onClick={() => fileInputRef.current?.click()} className="browse-button">Browse files <ArrowDownToLine size={13}/></button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif,image/bmp,.svg" onChange={onInput} hidden/>
            {busy && <div className="processing"><div className="processing-label"><LoaderCircle size={14} className="spin"/> Processing image <span>{progress}%</span></div><div className="progress-track"><span style={{width: progress + "%"}}/></div></div>}
            {error && <div className="error-message"><X size={14}/><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={13}/></button></div>}
            <div className="panel-divider"/>
            <div className="control-section"><div className="control-title"><span>RECONSTRUCTION</span><span className="title-muted">01 / 03</span></div><div className="slider-head"><label htmlFor="terms-slider">Number of terms</label><output>{settings.terms}</output></div><input id="terms-slider" className="range-input" type="range" min={8} max={Math.min(512, maxTerms)} step={8} value={Math.min(settings.terms, Math.min(512, maxTerms))} onChange={(e) => update("terms", Number(e.target.value))}/><div className="range-labels"><span>8 · Smooth</span><span>{Math.min(512, maxTerms)} · Detailed</span></div><div className="slider-head speed-head"><label htmlFor="speed-slider">Animation speed</label><output>{settings.speed.toFixed(1)}×</output></div><input id="speed-slider" className="range-input" type="range" min={0.25} max={3} step={0.25} value={settings.speed} onChange={(e) => update("speed", Number(e.target.value))}/><div className="range-labels"><span>Slow</span><span>Fast</span></div></div>
            <div className="panel-divider"/>
            <div className="control-section"><div className="control-title"><span>VISUAL LAYERS</span><span className="title-muted">02 / 03</span></div><LayerToggle label="Rotating circles" detail="Show each frequency radius" checked={settings.circles} onChange={(v) => update("circles", v)}/><LayerToggle label="Connection vectors" detail="Show the epicycle chain" checked={settings.vectors} onChange={(v) => update("vectors", v)}/><LayerToggle label="Reconstructed trace" detail="Keep the path behind the tip" checked={settings.trail} onChange={(v) => update("trail", v)}/><LayerToggle label="Original contour" detail="Compare with detected outline" checked={settings.source} onChange={(v) => update("source", v)}/></div>
            <div className="panel-divider"/>
            <button className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}><span><Settings2 size={15}/> Image processing</span><span className={showAdvanced ? "rotate" : ""}>⌄</span></button>
            {showAdvanced && <div className="advanced-content"><div className="slider-head"><label htmlFor="threshold">Dark-pixel threshold</label><output>{settings.threshold}</output></div><input id="threshold" type="range" min={20} max={245} step={5} className="range-input" value={settings.threshold} onChange={(e) => update("threshold", Number(e.target.value))}/><label className="checkbox-row"><input type="checkbox" checked={settings.invert} onChange={(e) => update("invert", e.target.checked)}/> Use light pixels as foreground</label><p className="hint">Threshold settings apply to raster images. SVG path geometry is sampled directly.</p></div>}
            <div className="panel-bottom"><div className="local-note"><span className="green-dot"/><span>All processing happens in your browser.</span></div><button className="secondary-full" onClick={() => {setSettings(DEFAULT);loadDemo();}}>Reset workspace <RotateCcw size={13}/></button></div>
          </aside>

          <div className="visual-column">
            <div className="visualizer-card"><div className="visualizer-top"><div className="visualizer-title"><span className="live-dot"/> <span>LIVE PREVIEW</span><span className="preview-divider">/</span><span className="preview-file">{fileName}</span></div><div className="visualizer-tools"><span className="coordinate-label">ℂ / 2D</span><button className="icon-button canvas-tool" title="Reset animation" onClick={resetAnimation}><RotateCcw size={14}/></button><button className="icon-button canvas-tool" title="Refresh view" onClick={() => setPlaying(true)}><Maximize2 size={14}/></button></div></div><div className="canvas-wrap"><canvas ref={canvasRef} aria-label="Animated Fourier epicycles reconstructing the selected curve"/><div className="canvas-corner top-left">RE(z) <span>·</span> IM(z)</div><div className="canvas-corner bottom-left"><span className="legend-dot source-legend"/> SOURCE PATH <span className="legend-dot trace-legend"/> RECONSTRUCTION</div><div className="canvas-corner bottom-right">t = {elapsed}</div>{busy && <div className="canvas-overlay"><LoaderCircle size={25} className="spin"/><span>Calculating Fourier coefficients…</span></div>}</div><div className="visualizer-controls"><button className="play-button" onClick={() => setPlaying((v) => !v)}>{playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}{playing ? "Pause" : "Play"}</button><div className="playback-track"><span style={{width: (Number(elapsed.split(":")[1]) / 60 * 100) + "%"}}/></div><span className="playback-speed">{settings.speed.toFixed(2)}×</span><button className="icon-button" onClick={resetAnimation} title="Restart playback"><RotateCcw size={14}/></button></div></div>
            <div className="metrics-grid"><Metric label="FOURIER TERMS" value={String(settings.terms).padStart(3,"0")} unit="coefficients" icon={<Waves size={15}/>} /><Metric label="ESTIMATED TRUNCATION ERROR" value={errorValue.toFixed(2)} unit="% · normalized RMS" icon={<Activity size={15}/>} /><Metric label="SAMPLING POINTS" value={String(sourcePoints.length).padStart(4,"0")} unit="contour points" icon={<ScanLine size={15}/>} /></div>
            <div className="export-row"><div><div className="export-title">Take the curve with you</div><div className="export-subtitle">Export the math or a scalable vector trace.</div></div><div className="export-actions"><button className="export-button" onClick={exportCoefficients}><FileJson size={15}/> Coefficients <span>JSON</span></button><button className="export-button export-primary" onClick={exportSvg}><ArrowDownToLine size={15}/> Export trace <span>SVG</span></button></div></div>
          </div>
        </div>
      </section>

      <section className="how-section" id="how-it-works"><div className="eyebrow small"><span className="eyebrow-line"/> UNDER THE CURVE</div><div className="how-heading"><h2>A shape, written<br/>as <span>frequencies.</span></h2><p>Any closed path can be approximated by adding rotating vectors at different frequencies. More terms bring more detail.</p></div><div className="steps-grid"><Step number="01" title="Trace the outline" text="Pixels or vector paths become a sequence of points around the shape."/><Step number="02" title="Find the frequencies" text="A fast Fourier transform separates the path into rotating complex vectors."/><Step number="03" title="Watch it emerge" text="Each vector turns at its own rate. Their final endpoint draws the curve."/></div><div className="equation-card"><div className="equation-label">THE COMPLEX FOURIER SERIES</div><div className="equation">z(t) = <span>Σ</span><sub>k ∈ K</sub> c<sub>k</sub> e<sup>i 2πkt</sup></div><div className="equation-note">A sum of rotating vectors · each coefficient sets amplitude and phase</div><div className="equation-decoration">∫ e<sup>iωt</sup> dt</div></div></section>

      <footer className="footer"><a className="brand footer-brand" href="#home"><span className="brand-mark"><AudioWaveform size={18}/></span><span>FOURIER<span className="brand-muted"> / STUDIO</span></span></a><span>Made of math, rendered in your browser.</span><div><a href="https://github.com/Yazito21/image-fourier" target="_blank" rel="noreferrer">Open source <Github size={13}/></a><span className="footer-dot">·</span><span>© 2026</span></div></footer>
    </main>
  );
}

function LayerToggle({ label, detail, checked, onChange }: {label:string;detail:string;checked:boolean;onChange:(v:boolean)=>void}) {
  return <label className="layer-toggle"><span className="toggle-copy"><span>{label}</span><small>{detail}</small></span><button type="button" role="switch" aria-checked={checked} className={"switch " + (checked ? "switch-on" : "")} onClick={(event) => { event.preventDefault(); onChange(!checked); }}><span/></button></label>;
}
function Metric({label,value,unit,icon}:{label:string;value:string;unit:string;icon:React.ReactNode}) {return <div className="metric-card"><div className="metric-icon">{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}<span>{unit}</span></div></div>;}
function Step({number,title,text}:{number:string;title:string;text:string}) {return <article className="step-card"><div className="step-number">{number}<span>—</span></div><h3>{title}</h3><p>{text}</p></article>;}
function downloadBlob(blob:Blob, name:string) { const url=URL.createObjectURL(blob); const anchor=document.createElement("a"); anchor.href=url; anchor.download=name; anchor.click(); window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
function safeName(value:string) { return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "fourier-curve"; }
