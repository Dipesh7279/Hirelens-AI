const ABSENT_SUSTAIN_MS = 5000;
const LOOKING_AWAY_SUSTAIN_MS = 6000;
const DEBOUNCE_MS = 15000;
const MAX_LOG_ENTRIES = 500;

// Per-interview in-memory tracker for sustained presence/attention signals and debounce windows.
// Cleared when an interview completes so memory stays bounded.
const interviewStates = new Map();

function createInitialState() {
  return {
    absentSince: null,
    lookingAwaySince: null,
    lastLogged: {},
  };
}

function getOrCreateState(interviewId) {
  const key = String(interviewId);
  let state = interviewStates.get(key);
  if (!state) {
    state = createInitialState();
    interviewStates.set(key, state);
  }
  return state;
}

/**
 * Pure state transition that derives server-side integrity events from a single CV frame result.
 * @param {object} state - mutable state { absentSince, lookingAwaySince, lastLogged }
 * @param {object} analysis - { faceCount, phoneDetected, confidence, lookingAway }
 * @param {number} nowMs - current epoch milliseconds
 * @returns {Array<{ event: string, confidence: number, timestamp: Date }>}
 */
function deriveFrameEvents(state, analysis = {}, nowMs = Date.now()) {
  const emitted = [];
  const faceCount = Number(analysis.faceCount) || 0;
  const phoneDetected = Boolean(analysis.phoneDetected);
  const lookingAway = Boolean(analysis.lookingAway);

  const tryEmit = (event, confidence) => {
    const last = state.lastLogged[event];
    if (last !== undefined && nowMs - last < DEBOUNCE_MS) return;
    state.lastLogged[event] = nowMs;
    const clampedConf = Math.min(1, Math.max(0, Number(confidence) || 0));
    emitted.push({
      event,
      confidence: clampedConf,
      timestamp: new Date(nowMs),
    });
  };

  if (faceCount > 1) {
    tryEmit('multiple_faces', 0.9);
  }

  if (phoneDetected) {
    const conf = Number(analysis.confidence) > 0 ? Number(analysis.confidence) : 0.8;
    tryEmit('phone_detected', conf);
  }

  if (faceCount === 0) {
    state.lookingAwaySince = null;
    if (state.absentSince === null) {
      state.absentSince = nowMs;
    } else if (nowMs - state.absentSince >= ABSENT_SUSTAIN_MS) {
      tryEmit('face_absent', 0.8);
    }
  } else {
    state.absentSince = null;
    if (lookingAway) {
      if (state.lookingAwaySince === null) {
        state.lookingAwaySince = nowMs;
      } else if (nowMs - state.lookingAwaySince >= LOOKING_AWAY_SUSTAIN_MS) {
        tryEmit('looking_away', 0.75);
      }
    } else {
      state.lookingAwaySince = null;
    }
  }

  return emitted;
}

function recordFrameAnalysis(interviewId, analysis, nowMs = Date.now()) {
  const state = getOrCreateState(interviewId);
  return deriveFrameEvents(state, analysis, nowMs);
}

function clearInterviewState(interviewId) {
  interviewStates.delete(String(interviewId));
}

function resetAllStates() {
  interviewStates.clear();
}

function clampTimestamp(rawTimestamp, startedAt, nowMs = Date.now()) {
  const parsed = rawTimestamp ? new Date(rawTimestamp).getTime() : nowMs;
  const candidateMs = Number.isFinite(parsed) ? parsed : nowMs;
  const minMs = startedAt ? new Date(startedAt).getTime() : 0;
  const lowerBound = Number.isFinite(minMs) && minMs <= nowMs ? minMs : 0;
  const clamped = Math.min(nowMs, Math.max(lowerBound, candidateMs));
  return new Date(clamped);
}

module.exports = {
  ABSENT_SUSTAIN_MS,
  LOOKING_AWAY_SUSTAIN_MS,
  DEBOUNCE_MS,
  MAX_LOG_ENTRIES,
  createInitialState,
  deriveFrameEvents,
  recordFrameAnalysis,
  clearInterviewState,
  resetAllStates,
  clampTimestamp,
};

