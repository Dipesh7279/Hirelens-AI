import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/axiosInstance';

const FRAME_INTERVAL_MS = 3000;
const FLUSH_INTERVAL_MS = 10000;
const TAB_DEBOUNCE_MS = 2000;

export default function InterviewRoom() {
  const { id } = useParams();
  const [room, setRoom] = useState(null);
  const [phase, setPhase] = useState('consent'); // consent | live | done
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [cvNotice, setCvNotice] = useState('');
  const [presenceChip, setPresenceChip] = useState('Face detected ✓');
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const buffer = useRef([]);
  const lastTabLogged = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    api.get(`/interviews/${id}/room`).then((r) => {
      setRoom(r.data);
      setAnswers(Object.fromEntries((r.data.responses || []).map((response) => [response.questionIndex, response.answer])));
      if (r.data.status === 'completed') {
        setPhase('done');
      } else if (r.data.status === 'in_progress' && r.data.consentGiven) {
        setAgreed(true);
        setPhase('resume_ready');
        const answeredIndices = new Set((r.data.responses || []).map((res) => res.questionIndex));
        const questionsCount = r.data.questions?.length || 0;
        let nextUnanswered = 0;
        while (nextUnanswered < questionsCount && answeredIndices.has(nextUnanswered)) {
          nextUnanswered++;
        }
        setCurrent(Math.min(nextUnanswered, Math.max(0, questionsCount - 1)));
      }
    }).catch(() => setError('Interview not found.'));
  }, [id]);

  // Queue only client-side tab_switch events; camera-derived presence/attention events are logged server-side.
  const recordTabSwitch = useCallback((confidence = 1) => {
    const now = Date.now();
    if (now - lastTabLogged.current < TAB_DEBOUNCE_MS) return;
    lastTabLogged.current = now;
    buffer.current.push({ event: 'tab_switch', confidence, timestamp: new Date(now).toISOString() });
  }, []);

  const flush = useCallback(async () => {
    if (!buffer.current.length) return;
    const events = buffer.current.splice(0);
    try {
      await api.post(`/interviews/${id}/integrity-log`, { events });
    } catch {
      buffer.current.unshift(...events); // retry next flush
    }
  }, [id]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', stopCamera);
    return () => {
      window.removeEventListener('pagehide', stopCamera);
      stopCamera();
    };
  }, [stopCamera]);

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      await api.post(`/interviews/${id}/consent`);
      setPhase('live');
    } catch (e) {
      // If camera access succeeded but the consent API failed, release the device.
      stopCamera();
      setError(e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Please allow camera access to begin.'
        : e.response?.data?.error || 'Could not start the interview.');
    }
  };

  const resumeInterview = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      setPhase('live');
    } catch (e) {
      stopCamera();
      setError(e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Please allow camera access to continue.'
        : 'Could not resume camera.');
    }
  };

  // attach stream once <video> exists
  useEffect(() => {
    if (phase === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  // Monitoring loops (only while live)
  useEffect(() => {
    if (phase !== 'live') return undefined;

    const onVisibility = () => document.hidden && recordTabSwitch(1);
    const onBlur = () => recordTabSwitch(0.6);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);

    const canvas = document.createElement('canvas');
    const sample = async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || inFlight.current) return;
      inFlight.current = true;
      try {
        canvas.width = 640;
        canvas.height = Math.round((video.videoHeight / video.videoWidth) * 640);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.7));
        const form = new FormData();
        form.append('file', blob, 'frame.jpg');
        const { data } = await api.post(`/interviews/${id}/frame`, form);
        setCvNotice('');

        if (data.faceCount === 0) {
          setPresenceChip('No face detected');
        } else if (data.lookingAway || data.faceCount > 1) {
          setPresenceChip('Please face the screen');
        } else {
          setPresenceChip('Face detected ✓');
        }
      } catch (e) {
        if (e.response?.status === 503) setCvNotice('Automated presence checks are temporarily unavailable.');
      } finally {
        inFlight.current = false;
      }
    };

    const frameTimer = setInterval(sample, FRAME_INTERVAL_MS);
    const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(frameTimer);
      clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, [phase, id, recordTabSwitch, flush]);

  const finish = async () => {
    if (room.questions.some((_, index) => !answers[index]?.trim())) {
      setError('Answer every question before completing the interview.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post(`/interviews/${id}/answers`, {
        responses: Object.entries(answers).map(([questionIndex, answer]) => ({ questionIndex: Number(questionIndex), answer })),
      });
      await flush();
      await api.post(`/interviews/${id}/complete`);
      stopCamera();
      setPhase('done');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save your answers and complete the interview. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveAndNext = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/interviews/${id}/answers`, {
        responses: Object.entries(answers).map(([questionIndex, answer]) => ({ questionIndex: Number(questionIndex), answer })),
      });
      setCurrent((index) => index + 1);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save your answer. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (error && !room) return <Shell><p className="text-rose-300">{error}</p></Shell>;
  if (!room) return <Shell><p className="text-slate-400">Loading…</p></Shell>;

  if (phase === 'done') {
    return (
      <Shell>
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-950/20 p-8 text-center space-y-4 shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-3xl text-emerald-400">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-white">Interview Complete & Sealed</h1>
          <p className="text-slate-300 max-w-md mx-auto">
            Your answers have been submitted and sealed. The hiring team has been notified and will review your technical responses alongside your verified profile.
          </p>
          <div className="pt-3 flex flex-wrap justify-center gap-3">
            <Link to="/feedback" className="rounded-xl bg-indigo-500 px-5 py-2.5 font-medium text-white hover:bg-indigo-400">
              View Recruiter Feedback
            </Link>
            <Link to="/dashboard" className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 font-medium text-slate-200 hover:bg-slate-700">
              Return to Dashboard
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'resume_ready') {
    return (
      <Shell>
        <div className="rounded-3xl border border-indigo-500/30 bg-slate-900/60 p-8 text-center space-y-4 shadow-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/20 text-2xl text-indigo-400">
            ▶
          </div>
          <h1 className="text-2xl font-bold text-white">{room.jobTitle} — Resume Interview</h1>
          <p className="text-slate-300 max-w-md mx-auto text-sm">
            You have an interview in progress. Your monitoring consent is recorded. Re-enable camera access to resume at Question {current + 1} of {room.questions?.length || 6}.
          </p>
          {error && <p role="alert" className="mt-3 text-rose-300 text-sm">{error}</p>}
          <div className="pt-2">
            <button
              type="button"
              onClick={resumeInterview}
              className="rounded-xl bg-indigo-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:bg-indigo-400"
            >
              Resume Interview Session →
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'consent') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">{room.jobTitle} — before you begin</h1>
        <div className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-slate-900/60 p-5 text-sm text-slate-300">
          <p className="font-semibold text-white">Camera monitoring consent</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Your camera is used only to check presence and attention during the interview.</li>
            <li>A still frame is analysed roughly every 3 seconds on our server and is <b>not saved</b>. No video or audio is recorded.</li>
            <li>We log only these event types with a timestamp: more than one face, face absent, phone visible, sustained looking away from the screen, and switching tabs/windows.</li>
            <li>These notes are visible to the recruiter as advisory information. They are <b>not</b> part of your skill score and never cause automatic rejection.</li>
          </ul>
          <label className="mt-3 flex items-center gap-2 text-white">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I understand and consent to the above.
          </label>
        </div>
        {error && <p role="alert" className="mt-3 text-rose-300">{error}</p>}
        <button onClick={start} disabled={!agreed}
          className="mt-4 rounded-xl bg-indigo-500 px-5 py-3 font-semibold disabled:opacity-50">
          Enable camera & start
        </button>
      </Shell>
    );
  }

  const q = room.questions[current];
  return (
    <Shell wide>
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <p className="text-xs uppercase tracking-widest text-indigo-300">
            Question {current + 1} of {room.questions.length} · {q?.type}
          </p>
          <p className="mt-3 text-xl font-medium">{q?.question}</p>
          <label className="mt-5 block text-sm text-slate-300">
            Your answer
            <textarea
              value={answers[current] || ''}
              onChange={(event) => setAnswers((previous) => ({ ...previous, [current]: event.target.value }))}
              maxLength={10000}
              rows={7}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-indigo-500"
              placeholder="Write your response here…"
            />
          </label>
          {error && <p role="alert" className="mt-3 text-rose-300">{error}</p>}
          <div className="mt-6 flex gap-3">
            <button disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}
              className="rounded-xl border border-slate-700 px-4 py-2 disabled:opacity-40">Previous</button>
            {current < room.questions.length - 1 ? (
              <button disabled={saving} onClick={saveAndNext} className="rounded-xl bg-indigo-500 px-4 py-2 font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save & next'}</button>
            ) : (
              <button disabled={saving} onClick={finish} className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Finish interview'}</button>
            )}
          </div>
        </div>
        <div>
          <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-2xl border border-white/10 bg-black" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">● Presence check active</p>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-200">
              {presenceChip}
            </span>
          </div>
          {cvNotice && <p className="mt-1 text-xs text-amber-300">{cvNotice}</p>}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, wide }) {
  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <div className={`mx-auto ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>{children}</div>
    </div>
  );
}
