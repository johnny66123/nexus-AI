import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type { MediaProject } from '../../shared/schema.ts';
import {
  analyzeImageProject,
  deleteMediaProject,
  fetchMediaProjects,
  formatRelativeTime,
  generateSvgProject,
  generateVoiceProject,
  transcribeMediaFile,
} from '../lib/api.ts';
import { MarkdownRenderer } from './MarkdownRenderer.tsx';

interface MediaStudioViewProps {
  canEdit: boolean;
  paidImageModelAvailable: boolean;
}

export function MediaStudioView({
  canEdit,
  paidImageModelAvailable,
}: MediaStudioViewProps) {
  const [tab, setTab] = useState<'voice' | 'transcribe' | 'image' | 'svg'>('voice');
  const [projects, setProjects] = useState<MediaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Voice Interaction State
  const [voiceTitle, setVoiceTitle] = useState('NEXUS Voice Brief');
  const [voicePrompt, setVoicePrompt] = useState('');
  const [voiceName, setVoiceName] = useState('Kore');
  const [askAssistantFirst, setAskAssistantFirst] = useState(true);
  const [voiceLoading, setVoiceLoading] = useState(false);

  // Transcription + Mic Recording State
  const [transcribeTitle, setTranscribeTitle] = useState('Audio Memo');
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  // SVG Generator State
  const [svgTitle, setSvgTitle] = useState('Architectural Emblem');
  const [svgPrompt, setSvgPrompt] = useState('');
  const [svgLoading, setSvgLoading] = useState(false);

  // Canvas Image Editor & Vision Inspector State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [grayscale, setGrayscale] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [visionPrompt, setVisionPrompt] = useState(
    'Inspect this image and summarize key visual elements, layout, and any readable text.',
  );
  const [visionLoading, setVisionLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await fetchMediaProjects();
        setProjects(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load media projects.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Render live Canvas Image adjustments
  useEffect(() => {
    if (!imagePreviewUrl || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const isRotated90 = rotation === 90 || rotation === 270;
      const maxDim = 640;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      canvas.width = isRotated90 ? h : w;
      canvas.height = isRotated90 ? w : h;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%)`;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    };
    img.src = imagePreviewUrl;
  }, [imagePreviewUrl, brightness, contrast, saturation, grayscale, rotation]);

  const handleVoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    setVoiceLoading(true);
    try {
      const project = await generateVoiceProject({
        title: voiceTitle,
        text: voicePrompt,
        voiceName,
        askAssistantFirst,
      });
      setProjects((prev) => [project, ...prev]);
      setVoicePrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice generation failed.');
    } finally {
      setVoiceLoading(false);
    }
  };

  const handleStartRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setTranscribeLoading(true);
        try {
          const project = await transcribeMediaFile(blob, transcribeTitle, 'recording.webm');
          setProjects((prev) => [project, ...prev]);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed.');
        } finally {
          setTranscribeLoading(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone permission denied or unavailable in this browser.');
    }
  };

  const handleStopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canEdit) return;
    setError(null);
    setTranscribeLoading(true);
    try {
      const project = await transcribeMediaFile(file, transcribeTitle || file.name, file.name);
      setProjects((prev) => [project, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio transcription failed.');
    } finally {
      setTranscribeLoading(false);
    }
  };

  const handleSvgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    setSvgLoading(true);
    try {
      const project = await generateSvgProject(svgTitle, svgPrompt);
      setProjects((prev) => [project, ...prev]);
      setSvgPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SVG generation failed.');
    } finally {
      setSvgLoading(false);
    }
  };

  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  const handleDownloadCanvas = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexus-edited-image.png';
    a.click();
  };

  const handleAnalyzeImage = async () => {
    if (!imageFile || !canEdit) return;
    setError(null);
    setVisionLoading(true);
    try {
      const project = await analyzeImageProject(imageFile, visionPrompt);
      setProjects((prev) => [project, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image analysis failed.');
    } finally {
      setVisionLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          AI Media Studio
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Voice interaction, audio transcription, canvas image editing with vision inspection, and
          vector SVG generation.
        </p>
      </div>

      {!paidImageModelAvailable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
          Note: Paid raster diffusion models (<span className="font-mono">gemini-3.1-flash-lite-image</span>)
          require a billing-enabled Gemini API key and are currently inactive. Voice synthesis,
          audio transcription, canvas image editing, vision analysis, and vector SVG creation are
          fully operational.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Mode Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-[#0B1120] p-1">
        {[
          { id: 'voice', label: 'Voice Interaction', icon: Volume2 },
          { id: 'transcribe', label: 'Audio Transcription', icon: Mic },
          { id: 'image', label: 'Canvas Editor & Vision', icon: ImageIcon },
          { id: 'svg', label: 'Vector SVG Studio', icon: Shapes },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as 'voice' | 'transcribe' | 'image' | 'svg')}
              className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Studio Workbench */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-6 lg:col-span-6">
          {tab === 'voice' && (
            <form onSubmit={handleVoiceSubmit} className="space-y-4">
              <h2 className="font-display text-base font-semibold text-white">
                Voice Synthesis &amp; Spoken Assistant
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={voiceTitle}
                  onChange={(e) => setVoiceTitle(e.target.value)}
                  placeholder="Project title"
                  className="rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white"
                />
                <select
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-sm text-white"
                >
                  {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map((v) => (
                    <option key={v} value={v}>
                      Voice: {v}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={4}
                required
                value={voicePrompt}
                onChange={(e) => setVoicePrompt(e.target.value)}
                placeholder={
                  askAssistantFirst
                    ? 'Ask NEXUS Voice Assistant a question to answer aloud...'
                    : 'Enter exact text to synthesize into WAV speech...'
                }
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500"
              />
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={askAssistantFirst}
                  onChange={(e) => setAskAssistantFirst(e.target.checked)}
                />
                <span>Generate AI conversational reply before synthesizing speech</span>
              </label>
              <button
                type="submit"
                disabled={!canEdit || voiceLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
              >
                {voiceLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
                <span>{voiceLoading ? 'Synthesizing WAV...' : 'Generate Voice Audio'}</span>
              </button>
            </form>
          )}

          {tab === 'transcribe' && (
            <div className="space-y-4">
              <h2 className="font-display text-base font-semibold text-white">
                Audio Transcription (Gemini 3.5 Transcribe)
              </h2>
              <input
                type="text"
                value={transcribeTitle}
                onChange={(e) => setTranscribeTitle(e.target.value)}
                placeholder="Transcription project title"
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!canEdit || transcribeLoading}
                  onClick={recording ? handleStopRecording : () => void handleStartRecording()}
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium text-white cursor-pointer ${
                    recording ? 'bg-rose-600 hover:bg-rose-500' : 'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  <span>{recording ? 'Stop & Transcribe' : 'Record Microphone'}</span>
                </button>

                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={!canEdit || transcribeLoading}
                  onClick={() => audioInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-[#060913] px-4 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                >
                  {transcribeLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span>Upload MP3 / WAV / WebM</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'image' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-white">
                  Canvas Image Editor &amp; Vision Analysis
                </h2>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Load Image</span>
                </button>
              </div>

              {imagePreviewUrl ? (
                <div className="space-y-4">
                  <div className="flex justify-center overflow-hidden rounded-lg border border-slate-800 bg-[#060913] p-2">
                    <canvas ref={canvasRef} className="max-h-64 max-w-full rounded" />
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                    <label className="space-y-1">
                      <span>Brightness ({brightness}%)</span>
                      <input
                        type="range"
                        min={40}
                        max={160}
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                    <label className="space-y-1">
                      <span>Contrast ({contrast}%)</span>
                      <input
                        type="range"
                        min={50}
                        max={180}
                        value={contrast}
                        onChange={(e) => setContrast(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                    <label className="space-y-1">
                      <span>Saturation ({saturation}%)</span>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={saturation}
                        onChange={(e) => setSaturation(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                    <label className="space-y-1">
                      <span>Grayscale ({grayscale}%)</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={grayscale}
                        onChange={(e) => setGrayscale(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      Rotate 90°
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadCanvas}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Export Edited PNG</span>
                    </button>
                  </div>

                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <input
                      type="text"
                      value={visionPrompt}
                      onChange={(e) => setVisionPrompt(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3 py-2 text-xs text-white"
                    />
                    <button
                      type="button"
                      disabled={!canEdit || visionLoading}
                      onClick={() => void handleAnalyzeImage()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                    >
                      {visionLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>Inspect Image with Gemini Vision</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-800 bg-[#060913] p-10 text-center text-xs text-slate-400">
                  Load a PNG, JPEG, or WebP image to edit filters/rotation non-destructively or run
                  Gemini Vision inspection.
                </div>
              )}
            </div>
          )}

          {tab === 'svg' && (
            <form onSubmit={handleSvgSubmit} className="space-y-4">
              <h2 className="font-display text-base font-semibold text-white">
                AI Vector SVG Studio
              </h2>
              <input
                type="text"
                value={svgTitle}
                onChange={(e) => setSvgTitle(e.target.value)}
                placeholder="Vector project title"
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2 text-sm text-white"
              />
              <textarea
                rows={4}
                required
                value={svgPrompt}
                onChange={(e) => setSvgPrompt(e.target.value)}
                placeholder="Describe a geometric emblem, architecture diagram, or abstract dark-mode graphic..."
                className="w-full rounded-lg border border-slate-800 bg-[#060913] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={!canEdit || svgLoading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
              >
                {svgLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shapes className="h-4 w-4" />
                )}
                <span>{svgLoading ? 'Generating Vector...' : 'Generate SVG Graphic'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Saved Media Projects Library */}
        <div className="space-y-4 lg:col-span-6">
          <h2 className="font-display text-base font-semibold text-white">
            Media Projects ({projects.length})
          </h2>

          {loading ? (
            <div className="h-64 animate-pulse rounded-xl bg-[#0B1120]" />
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-[#0B1120]/60 p-10 text-center text-sm text-slate-400">
              No media projects saved yet. Generate voice audio, transcribe a clip, inspect an
              image, or build an SVG vector graphic.
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => (
                <article
                  key={p.id}
                  className="rounded-xl border border-slate-800/80 bg-[#0B1120] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-white">{p.title}</h3>
                      <p className="font-mono text-[11px] text-slate-400">
                        {p.kind.replace('_', ' ')} · {formatRelativeTime(p.createdAt)}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteMediaProject(p.id);
                          setProjects((prev) => prev.filter((item) => item.id !== p.id));
                        }}
                        aria-label={`Delete ${p.title}`}
                        className="rounded p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {p.audioDataUrl && (
                    <audio controls src={p.audioDataUrl} className="w-full h-9" />
                  )}

                  {p.svgContent && (
                    <div className="space-y-2">
                      <div
                        className="overflow-hidden rounded-lg border border-slate-800 bg-[#060913] p-2"
                        dangerouslySetInnerHTML={{ __html: p.svgContent }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const blob = new Blob([p.svgContent!], { type: 'image/svg+xml' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${p.title.toLowerCase().replace(/\s+/g, '-')}.svg`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:underline cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download SVG</span>
                      </button>
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-800 bg-[#060913] p-3 text-xs text-slate-300">
                    <MarkdownRenderer content={p.resultText} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
