/**
 * Advisory integrity summary for completed interviews.
 * Level rule:
 *   - 0 total events -> 'none'
 *   - 1 to 3 total events -> 'low'
 *   - > 3 total events -> 'review'
 * Advisory only: never feeds ScoreRecord, candidate ranking, or automated rejection.
 */
function summarizeIntegrity(interview = {}) {
  const counts = {
    multiple_faces: 0,
    face_absent: 0,
    phone_detected: 0,
    looking_away: 0,
    tab_switch: 0,
  };
  const log = Array.isArray(interview.integrityLog) ? interview.integrityLog : [];
  for (const item of log) {
    if (item && Object.prototype.hasOwnProperty.call(counts, item.event)) {
      counts[item.event] += 1;
    }
  }
  const totalEvents = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const level = totalEvents === 0 ? 'none' : totalEvents <= 3 ? 'low' : 'review';

  let durationMinutes = 0;
  if (interview.startedAt && interview.completedAt) {
    const diffMs = new Date(interview.completedAt).getTime() - new Date(interview.startedAt).getTime();
    if (Number.isFinite(diffMs) && diffMs > 0) {
      durationMinutes = Math.round((diffMs / 60000) * 10) / 10;
    }
  }

  return {
    framesAnalyzed: Number(interview.framesAnalyzed) || 0,
    durationMinutes,
    counts,
    level,
    advisoryNote: 'Advisory - not part of the score',
  };
}

function discloseIntegrityAfterCompletion(interview) {
  const result = typeof interview.toObject === 'function'
    ? interview.toObject()
    : { ...interview };
  if (result.status !== 'completed') {
    result.integrityLog = [];
    delete result.integritySummary;
  } else {
    result.integritySummary = summarizeIntegrity(result);
  }
  return result;
}

module.exports = { discloseIntegrityAfterCompletion, summarizeIntegrity };
