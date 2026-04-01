import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Camera, Clock, History, ScanFace, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../lib/api';

const DEFAULT_TERMINAL_ID = 'campus-gate-1';
// Keep these in sync with the AI service guide-ellipse defaults.
const GUIDE_ELLIPSE = {
    widthPercent: 46,
    heightPercent: 78,
    centerXPercent: 50,
    centerYPercent: 50,
    labelTopPercent: 16
} as const;

type RecognitionStatus =
    | 'Success'
    | 'Duplicate'
    | 'ReviewRequired'
    | 'Pending'
    | 'Unknown'
    | 'Blocked'
    | 'MultipleFaces'
    | 'NoFace'
    | 'TooDark'
    | 'TooBlurry'
    | 'MoveCloser'
    | 'CenterFace'
    | 'FrameRetry'
    | 'Error';

type RecognitionLog = {
    id: number;
    name: string;
    time: string;
    status: RecognitionStatus;
    message: string;
};

type LiveGuide = {
    status: RecognitionStatus | 'Idle';
    title: string;
    message: string;
    tone: 'neutral' | 'ready' | 'warning' | 'danger' | 'success';
    progressCurrent: number;
    progressTotal: number;
};

const DEFAULT_GUIDE: LiveGuide = {
    status: 'Idle',
    title: 'Align Face To Start',
    message: 'Stand alone inside the guide circle, look at the camera, and hold steady.',
    tone: 'neutral',
    progressCurrent: 0,
    progressTotal: 3
};

const getLogName = (status: RecognitionStatus, student?: string | null) => {
    if (student) return student;
    if (status === 'MultipleFaces') return 'Multiple People Detected';
    if (status === 'NoFace') return 'No Face Detected';
    if (status === 'TooDark') return 'Too Dark';
    if (status === 'TooBlurry') return 'Hold Camera Steady';
    if (status === 'MoveCloser') return 'Move Closer';
    if (status === 'CenterFace') return 'Center Your Face';
    if (status === 'FrameRetry') return 'Retrying Scan';
    if (status === 'Unknown') return 'Not Recognized';
    if (status === 'Error') return 'System Error';
    return 'Face Scan';
};

const parsePendingProgress = (message?: string) => {
    const match = message?.match(/\((\d+)\/(\d+)\)/);
    if (!match) {
        return null;
    }

    return {
        current: Number(match[1]),
        total: Number(match[2])
    };
};

const getCaptureDelay = (status?: string) => {
    if (status === 'Busy') return 350;
    if (status === 'Pending') return 700;
    if (status === 'MultipleFaces') return 1800;
    if (status === 'NoFace') return 1200;
    if (status === 'TooDark' || status === 'TooBlurry' || status === 'MoveCloser' || status === 'CenterFace') return 1100;
    if (status === 'FrameRetry') return 500;
    if (status === 'Success' || status === 'Duplicate' || status === 'ReviewRequired') return 1600;
    if (status === 'Blocked') return 2000;
    return 1400;
};

const shouldPromoteToLastScan = (status: RecognitionStatus) => (
    ['Success', 'Duplicate', 'ReviewRequired', 'Blocked', 'MultipleFaces', 'TooDark', 'TooBlurry', 'MoveCloser', 'CenterFace', 'Unknown', 'Error'].includes(status)
);

const useCompactOverlay = (status: RecognitionStatus) => (
    ['MultipleFaces', 'NoFace', 'TooDark', 'TooBlurry', 'MoveCloser', 'CenterFace', 'FrameRetry', 'Unknown', 'Blocked', 'Error'].includes(status)
);

const buildGuide = (status: RecognitionStatus | 'Idle', message?: string): LiveGuide => {
    const pendingProgress = parsePendingProgress(message);

    if (status === 'Pending') {
        return {
            status,
            title: 'Hold Steady',
            message: message || 'One clear face found. Keep still while we confirm the match.',
            tone: 'ready',
            progressCurrent: pendingProgress?.current || 1,
            progressTotal: pendingProgress?.total || 3
        };
    }

    if (status === 'MultipleFaces') {
        return {
            status,
            title: 'One Person Only',
            message: message || 'Ask others to step out of the frame before scanning.',
            tone: 'danger',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'NoFace') {
        return {
            status,
            title: 'Face Not Visible',
            message: message || 'Step into the guide circle and look directly at the camera.',
            tone: 'warning',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'MoveCloser') {
        return {
            status,
            title: 'Move Closer',
            message: message || 'Bring your face larger inside the guide circle so the camera can capture enough detail.',
            tone: 'warning',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'CenterFace') {
        return {
            status,
            title: 'Center Your Face',
            message: message || 'Place your face fully inside the guide circle.',
            tone: 'warning',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'FrameRetry') {
        return {
            status,
            title: 'Reading Camera Frame',
            message: message || 'Hold steady while the kiosk retries a cleaner frame.',
            tone: 'neutral',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'TooDark') {
        return {
            status,
            title: 'Need Better Light',
            message: message || 'Face the light source or reduce shadows before scanning.',
            tone: 'warning',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'TooBlurry') {
        return {
            status,
            title: 'Hold Still',
            message: message || 'Keep your head and the camera steady for a sharper scan.',
            tone: 'warning',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'Success') {
        return {
            status,
            title: 'Attendance Marked',
            message: message || 'Recognition completed successfully.',
            tone: 'success',
            progressCurrent: 3,
            progressTotal: 3
        };
    }

    if (status === 'Duplicate') {
        return {
            status,
            title: 'Already Processed',
            message: message || 'This attendance was already captured recently.',
            tone: 'neutral',
            progressCurrent: 3,
            progressTotal: 3
        };
    }

    if (status === 'ReviewRequired') {
        return {
            status,
            title: 'Sent For Review',
            message: message || 'A staff member will verify this scan.',
            tone: 'neutral',
            progressCurrent: 3,
            progressTotal: 3
        };
    }

    if (status === 'Blocked') {
        return {
            status,
            title: 'Attendance Blocked',
            message: message || 'Attendance cannot be marked right now.',
            tone: 'danger',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'Unknown') {
        return {
            status,
            title: 'Face Not Recognized',
            message: message || 'Try again with a clear front-facing pose and stable lighting.',
            tone: 'warning',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    if (status === 'Error') {
        return {
            status,
            title: 'System Error',
            message: message || 'Recognition service is unavailable. Please try again shortly.',
            tone: 'danger',
            progressCurrent: 0,
            progressTotal: 3
        };
    }

    return DEFAULT_GUIDE;
};

const getGuideToneClasses = (tone: LiveGuide['tone']) => {
    if (tone === 'ready') return 'border-emerald-200 bg-emerald-50/90 text-emerald-900';
    if (tone === 'warning') return 'border-amber-200 bg-amber-50/90 text-amber-900';
    if (tone === 'danger') return 'border-rose-200 bg-rose-50/90 text-rose-900';
    if (tone === 'success') return 'border-green-200 bg-green-50/90 text-green-900';
    return 'border-slate-200 bg-white/85 text-slate-900';
};

const getGuideFrameClasses = (tone: LiveGuide['tone']) => {
    if (tone === 'ready') return 'border-emerald-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)]';
    if (tone === 'warning') return 'border-amber-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.24)]';
    if (tone === 'danger') return 'border-rose-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.28)]';
    if (tone === 'success') return 'border-green-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.16)]';
    return 'border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.2)]';
};

const pushLog = (prev: RecognitionLog[], next: RecognitionLog) => {
    const current = prev[0];
    if (current && current.status === next.status && current.message === next.message && current.name === next.name) {
        return prev;
    }

    return [next, ...prev].slice(0, 12);
};

const AttendanceKiosk: React.FC = () => {
    const webcamRef = useRef<Webcam>(null);
    const [logs, setLogs] = useState<RecognitionLog[]>([]);
    const [lastScan, setLastScan] = useState<RecognitionLog | null>(null);
    const [isCapturing, setIsCapturing] = useState(true);
    const [terminalId, setTerminalId] = useState(DEFAULT_TERMINAL_ID);
    const [liveGuide, setLiveGuide] = useState<LiveGuide>(DEFAULT_GUIDE);

    useEffect(() => {
        let active = true;

        const captureFrame = async () => {
            if (!isCapturing || !active) return;

            const imageSrc = webcamRef.current?.getScreenshot();
            if (!imageSrc) {
                if (active) setTimeout(captureFrame, 1000);
                return;
            }

            try {
                const res = await api.post('/recognize', { 
                    imageBase64: imageSrc, 
                    terminalId,
                    enforceGuide: true
                });
                
                const { student, status, message } = res.data;
                const scanStatus = (status || 'Pending') as RecognitionStatus;
                setLiveGuide(buildGuide(scanStatus, message));
                
                // Only log if it's not a "Busy" status (to avoid clutter)
                if (status !== 'Busy') {
                    const log: RecognitionLog = {
                        id: Date.now(),
                        name: getLogName(scanStatus, student),
                        time: new Date().toLocaleTimeString(),
                        status: scanStatus,
                        message: message || 'Scanning'
                    };
                    
                    if (scanStatus === 'Blocked') {
                        setIsCapturing(false);
                    }
                    
                    if (shouldPromoteToLastScan(scanStatus)) {
                        setLastScan(log);
                    }
                    
                    setLogs((prev) => pushLog(prev, log));
                }

                const delay = getCaptureDelay(status);
                if (active) setTimeout(captureFrame, delay);

            } catch (err: any) {
                const backend = err.response?.data || {};
                const scanStatus = (
                    backend.status === 'MultipleFaces' ||
                    backend.status === 'NoFace' ||
                    backend.status === 'TooDark' ||
                    backend.status === 'TooBlurry' ||
                    backend.status === 'MoveCloser' ||
                    backend.status === 'CenterFace' ||
                    backend.status === 'FrameRetry' ||
                    backend.status === 'Unknown'
                        ? backend.status
                        : 'Error'
                ) as RecognitionStatus;
                setLiveGuide(buildGuide(scanStatus, backend.message));
                const log: RecognitionLog = {
                    id: Date.now(),
                    name: getLogName(scanStatus),
                    time: new Date().toLocaleTimeString(),
                    status: scanStatus,
                    message: [backend.message, backend.error, backend.details].filter(Boolean).join(' - ') || 'Service unavailable'
                };
                if (shouldPromoteToLastScan(scanStatus)) {
                    setLastScan(log);
                }
                setLogs((prev) => pushLog(prev, log));
                
                // Retry after error
                if (active) setTimeout(captureFrame, 3000);
            }
        };

        if (isCapturing) {
            captureFrame();
        }

        return () => {
            active = false;
        };
    }, [isCapturing, terminalId]);

    const getStatusLabel = (status: RecognitionStatus) => {
        if (status === 'Success') return 'Marked Present';
        if (status === 'Duplicate') return 'Already Logged';
        if (status === 'ReviewRequired') return 'Sent For Review';
        if (status === 'Pending') return 'Hold Steady';
        if (status === 'Blocked') return 'Attendance Blocked';
        if (status === 'MultipleFaces') return 'One Person Only';
        if (status === 'NoFace') return 'Face Not Visible';
        if (status === 'TooDark') return 'Need Better Light';
        if (status === 'TooBlurry') return 'Hold Still';
        if (status === 'MoveCloser') return 'Move Closer';
        if (status === 'CenterFace') return 'Center Your Face';
        if (status === 'FrameRetry') return 'Retrying Frame';
        if (status === 'Unknown') return 'Not Recognized';
        return 'System Error';
    };

    const getStatusClasses = (status: RecognitionStatus) => {
        if (status === 'Success') return 'bg-green-50 border-green-100 text-green-700';
        if (status === 'Duplicate') return 'bg-amber-50 border-amber-100 text-amber-700';
        if (status === 'ReviewRequired') return 'bg-blue-50 border-blue-100 text-blue-700';
        if (status === 'Pending') return 'bg-slate-50 border-slate-100 text-slate-700';
        if (status === 'Blocked') return 'bg-indigo-50 border-indigo-100 text-indigo-700';
        if (status === 'MultipleFaces') return 'bg-amber-50 border-amber-100 text-amber-700';
        if (status === 'NoFace') return 'bg-slate-50 border-slate-100 text-slate-700';
        if (status === 'TooDark') return 'bg-violet-50 border-violet-100 text-violet-700';
        if (status === 'TooBlurry') return 'bg-sky-50 border-sky-100 text-sky-700';
        if (status === 'MoveCloser') return 'bg-cyan-50 border-cyan-100 text-cyan-700';
        if (status === 'CenterFace') return 'bg-fuchsia-50 border-fuchsia-100 text-fuchsia-700';
        if (status === 'FrameRetry') return 'bg-slate-50 border-slate-100 text-slate-700';
        if (status === 'Unknown') return 'bg-orange-50 border-orange-100 text-orange-700';
        return 'bg-red-50 border-red-100 text-red-700';
    };

    return (
        <div className="fixed inset-0 bg-slate-50 flex flex-col overflow-hidden">
            <header className="bg-white border-b border-slate-200 p-6 flex items-center justify-between shadow-sm z-20">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 rounded-lg shadow-indigo-100 shadow-xl">
                        <ShieldCheck className="text-white w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-slate-900 text-2xl font-black tracking-tight uppercase">AI Attendance Terminal</h1>
                        <p className="text-slate-500 text-sm font-semibold">Live recognition with consensus and review workflow</p>
                    </div>
                </div>
                <div className="text-right hidden md:block">
                    <div className="text-slate-900 text-lg font-mono font-bold tracking-wide">
                        {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                    <div className="text-indigo-600 text-sm font-bold uppercase tracking-widest flex items-center justify-end gap-2">
                        <Clock size={16} /> {terminalId}
                    </div>
                </div>
            </header>

            <main className="flex-1 flex flex-col lg:flex-row p-6 gap-6">
                <div className="flex-[3] relative flex flex-col gap-4">
                    <div className="relative aspect-video rounded-3xl overflow-hidden border-8 border-white bg-slate-200 shadow-2xl flex items-center justify-center ring-1 ring-slate-200">
                        <Webcam
                            audio={false}
                            ref={webcamRef}
                            screenshotFormat="image/jpeg"
                            screenshotQuality={0.95}
                            forceScreenshotSourceSize
                            className="w-full h-full object-cover"
                            videoConstraints={{ width: 1280, height: 720, facingMode: 'user' }}
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/25 via-transparent to-slate-950/30" />
                        <div
                            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[46%] border-[3px] transition-all duration-300 ${getGuideFrameClasses(liveGuide.tone)}`}
                            style={{
                                left: `${GUIDE_ELLIPSE.centerXPercent}%`,
                                top: `${GUIDE_ELLIPSE.centerYPercent}%`,
                                width: `${GUIDE_ELLIPSE.widthPercent}%`,
                                height: `${GUIDE_ELLIPSE.heightPercent}%`
                            }}
                        />
                        <div
                            className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-white/88 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-slate-700 shadow-lg backdrop-blur"
                            style={{ top: `${GUIDE_ELLIPSE.labelTopPercent}%` }}
                        >
                            Stand Alone In Frame
                        </div>
                        <div className="pointer-events-none absolute inset-x-6 top-6 flex justify-end">
                            <div className={`max-w-sm rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${getGuideToneClasses(liveGuide.tone)}`}>
                                <div className="flex items-start gap-3">
                                    {liveGuide.tone === 'danger' ? <ShieldAlert size={18} className="mt-0.5" /> : <ScanFace size={18} className="mt-0.5" />}
                                    <div className="min-w-0">
                                        <div className="text-[11px] font-black uppercase tracking-[0.24em]">
                                            {liveGuide.title}
                                        </div>
                                        <div className="mt-1 text-sm leading-relaxed">
                                            {liveGuide.message}
                                        </div>
                                        {liveGuide.progressCurrent > 0 && (
                                            <div className="mt-3">
                                                <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em]">
                                                    <span>Stability Check</span>
                                                    <span>{liveGuide.progressCurrent}/{liveGuide.progressTotal}</span>
                                                </div>
                                                <div className="h-2 overflow-hidden rounded-full bg-slate-900/10">
                                                    <div
                                                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                                                        style={{ width: `${(liveGuide.progressCurrent / liveGuide.progressTotal) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        {lastScan && (
                            <div
                                className={`absolute right-6 bg-white/90 backdrop-blur-md border border-slate-200 shadow-2xl flex flex-col items-center text-center ${
                                    useCompactOverlay(lastScan.status)
                                        ? 'bottom-6 w-[min(360px,calc(100%-3rem))] px-5 py-3 rounded-2xl gap-1.5'
                                        : 'bottom-8 w-[min(420px,calc(100%-3rem))] px-8 py-5 rounded-3xl gap-2'
                                }`}
                            >
                                <p className={`text-slate-400 font-black uppercase tracking-[0.2em] ${useCompactOverlay(lastScan.status) ? 'text-[10px]' : 'text-xs'}`}>
                                    {getStatusLabel(lastScan.status)}
                                </p>
                                <h2 className={`text-slate-900 font-black ${useCompactOverlay(lastScan.status) ? 'text-xl' : 'text-3xl'}`}>
                                    {lastScan.name}
                                </h2>
                                <p className={`text-slate-500 ${useCompactOverlay(lastScan.status) ? 'max-w-[360px] text-xs' : 'max-w-md text-sm'}`}>
                                    {lastScan.message}
                                </p>
                            </div>
                        )}
                        <div className="absolute top-8 left-8 flex items-center gap-3 bg-white/80 backdrop-blur px-5 py-2.5 rounded-full border border-slate-200 shadow-sm">
                            <Camera className="text-red-500 animate-pulse" size={18} />
                            <span className="text-slate-900 text-xs font-black uppercase tracking-wider">{isCapturing ? 'Camera Active' : 'Capture Paused'}</span>
                        </div>
                        <div className="absolute bottom-8 left-8 rounded-2xl border border-white/50 bg-slate-950/55 px-4 py-3 text-white shadow-lg backdrop-blur">
                            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/80">
                                <Sparkles size={14} /> Best Scan Tips
                            </div>
                            <div className="mt-2 space-y-1 text-xs leading-relaxed text-white/90">
                                <div>One student only in front of camera</div>
                                <div>Face inside circle, eyes forward, shoulders steady</div>
                                <div>Use bright, even light on the face</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col gap-6 min-w-[360px]">
                    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xl">
                        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                            <ScanFace className="text-indigo-600" />
                            <div>
                                <h3 className="text-slate-900 text-lg font-black uppercase tracking-tight">Live Guide</h3>
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{liveGuide.title}</p>
                            </div>
                        </div>
                        <p className="mt-4 text-sm leading-relaxed text-slate-600">{liveGuide.message}</p>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                            <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                <div>Mode</div>
                                <div className="mt-1 text-sm text-slate-900">{isCapturing ? 'Active Scan' : 'Paused'}</div>
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-4 py-3">
                                <div>Stability</div>
                                <div className="mt-1 text-sm text-slate-900">{liveGuide.progressCurrent}/{liveGuide.progressTotal}</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col shadow-xl">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-slate-900 text-lg font-black uppercase tracking-tight flex items-center gap-3 border-b-2 border-indigo-100 pb-2">
                                <History className="text-indigo-600" /> Recent Activity
                            </h3>
                            <button onClick={() => setIsCapturing((prev) => !prev)} className={`text-xs px-3 py-2 rounded-lg font-black uppercase tracking-widest border-2 ${isCapturing ? 'border-red-100 text-red-600 bg-red-50 hover:bg-red-100' : 'border-green-100 text-green-600 bg-green-50 hover:bg-green-100'}`}>
                                {isCapturing ? 'Stop' : 'Start'}
                            </button>
                        </div>

                        <div className="mb-4">
                            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Terminal ID</label>
                            <input value={terminalId} onChange={(event) => setTerminalId(event.target.value)} className="w-full rounded-lg border px-3 py-2" />
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                            {logs.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-10 opacity-40">
                                    <Clock className="text-slate-300 mb-4" size={64} />
                                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Waiting for Scans...</p>
                                </div>
                            ) : logs.map((log) => (
                                <div key={log.id} className={`p-4 rounded-2xl border shadow-sm ${getStatusClasses(log.status)}`}>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-base font-black truncate max-w-[180px]">{log.name}</span>
                                        <span className="text-[10px] font-mono font-bold">{log.time}</span>
                                    </div>
                                    <div className="text-[11px] font-bold uppercase tracking-widest">{getStatusLabel(log.status)}</div>
                                    <div className="text-xs mt-1 leading-relaxed">{log.message}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AttendanceKiosk;

