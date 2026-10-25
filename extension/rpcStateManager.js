window.RPCStateManager = class {
  constructor() {
    this.lastActivity = null;
    this.trackStartTime = Date.now();
    this.lastKnownPosition = 0;
    this.lastPosition = 0;
    this.seekTimeout = null;
    this.errorCount = 0;

    // Has Only Duration Mode
    this.durationTimer = 0;
    this.durationTimerInterval = null;
    this.hasOnlyDuration = false;
    this.hasOnlyDurationCount = 0;
    this.calculatedTotalDuration = null;

    // Remaining Mode
    this.isRemainingMode = false;
    this.consecutiveRemaining = 0;
    this.consecutiveNormal = 0;

    // Last Valid Values
    this.lastValidPosition = null;
    this.lastValidDuration = null;
    this.lastCheckTime = null;
  }

  analyzePlayback(currentPos, duration, isPlaying) {
    const now = Date.now();

    if (typeof currentPos !== "number" || isNaN(currentPos)) {
      this.lastCheckTime = now;
      return { isPaused: !isPlaying, isSeeking: false };
    }

    const justStarted = now - this.trackStartTime < 3000;
    if (this.lastCheckTime === null || justStarted) {
      this.lastCheckTime = now;
      this.lastKnownPosition = currentPos;
      return { isPaused: !isPlaying, isSeeking: false };
    }

    const isRadio = !isFinite(duration) || duration <= 0;
    if (isRadio) {
      this.lastCheckTime = now;
      this.lastKnownPosition = currentPos;
      return { isPaused: !isPlaying, isSeeking: false };
    }

    const elapsedWallTime = (now - this.lastCheckTime) / 1000;
    const hasPrevPos = typeof this.lastKnownPosition === "number" && isFinite(this.lastKnownPosition);

    const expectedPos = hasPrevPos ? this.lastKnownPosition + elapsedWallTime : currentPos;
    const drift = Math.abs(currentPos - expectedPos);

    const hasValidDuration = typeof duration === "number" && isFinite(duration) && duration > 0;
    const baseThreshold = 6;
    const threshold = hasValidDuration ? Math.min(baseThreshold, duration / 3) : baseThreshold;

    const isSeeking = hasPrevPos && !this.hasOnlyDuration && drift > threshold;
    const movementThreshold = Math.max(0.5, elapsedWallTime * 0.5);
    const positionFrozen = hasPrevPos && Math.abs(currentPos - this.lastKnownPosition) < movementThreshold && elapsedWallTime > 7.0;
    const isPaused = !isPlaying || (!isSeeking && positionFrozen);

    this.lastCheckTime = now;
    this.lastKnownPosition = currentPos;

    return { isPaused, isSeeking };
  }

  updateModes(rawTime, rawDuration) {
    const now = Date.now();
    const justStarted = now - this.trackStartTime < 2000;
    const hasTime = typeof rawTime === "number" && !isNaN(rawTime);
    const hasValidDuration = typeof rawDuration === "number" && isFinite(rawDuration) && rawDuration > 0;
    const isRemainingCandidate = typeof rawDuration === "number" && !isNaN(rawDuration) && rawDuration < 0;

    // Remaining Mode
    if (isRemainingCandidate) {
      this.consecutiveRemaining++;
      this.consecutiveNormal = 0;
    } else {
      this.consecutiveNormal++;
      this.consecutiveRemaining = 0;
    }

    if (this.consecutiveRemaining >= 2) this.isRemainingMode = true;
    if (this.consecutiveNormal >= 4) this.isRemainingMode = false;

    if (this.isRemainingMode) {
      if (this.hasOnlyDuration) {
        this.hasOnlyDuration = false;
        this.resetDurationTimer();
      }
      return;
    }

    // Only Duration Mode
    if (!hasTime && hasValidDuration) {
      // Saturate counter to prevent overflow
      this.hasOnlyDurationCount = Math.min(this.hasOnlyDurationCount + 1, 5);

      // Activate only after parser stabilizes (not during justStarted)
      if (!this.hasOnlyDuration && !justStarted) {
        this.hasOnlyDuration = true;
        this.hasOnlyDurationCount = 0;
        this.startDurationTimer();
      }
    } else {
      // If both time and duration are present, reset the counter.
      if (hasTime) {
        this.hasOnlyDurationCount = 0;
        if (this.hasOnlyDuration) {
          this.hasOnlyDuration = false;
          this.resetDurationTimer();
        }
        // Flicker protection only applies when time is absent but duration is also absent.
      } else if (this.hasOnlyDurationCount > 0) {
        this.hasOnlyDurationCount--;
      } else if (this.hasOnlyDuration) {
        this.hasOnlyDuration = false;
        this.resetDurationTimer();
      }
    }
  }

  keepActivity(activity) {
    this.lastActivity ??= { ...activity, lastUpdated: null };
  }

  isActivityChanged(newActivity) {
    const prev = this.lastActivity;
    if (!prev) return false;

    const titleChanged = (newActivity.title ?? "").trim() !== (prev.title ?? "").trim();
    const artistChanged = (newActivity.artist ?? "").trim() !== (prev.artist ?? "").trim();

    return titleChanged || artistChanged;
  }

  updateLastActivity(activity, progress) {
    this.lastActivity = { ...activity, progress, lastUpdated: Date.now() };
  }

  setSeekTimeout(callback, delay) {
    clearTimeout(this.seekTimeout);
    this.seekTimeout = setTimeout(callback, delay);
  }

  incrementError() {
    return ++this.errorCount;
  }

  clearError() {
    this.errorCount = 0;
  }

  hasExceededErrorLimit(limit = 5) {
    return this.errorCount >= limit;
  }

  isStuck(threshold = 20000) {
    return !!(this.lastActivity && Date.now() - this.lastActivity.lastUpdated > threshold);
  }

  reset() {
    this.lastActivity = null;
    this.lastPosition = 0;
    this.lastKnownPosition = 0;
    clearTimeout(this.seekTimeout);
    this.seekTimeout = null;
    this.errorCount = 0;
    this.lastCheckTime = null;
    this.hasOnlyDuration = false;
    this.hasOnlyDurationCount = 0;
    this.lastValidPosition = null;
    this.lastValidDuration = null;
    this.resetDurationTimer();
    this.resetRemainingState();
    this.trackStartTime = Date.now();
  }

  resetRemainingState() {
    this.isRemainingMode = false;
    this.consecutiveRemaining = 0;
    this.consecutiveNormal = 0;
    this.calculatedTotalDuration = null;
    this.lastValidPosition = null;
    this.lastValidDuration = null;
  }

  startDurationTimer() {
    if (this.durationTimerInterval) return;

    const seed =
      this.lastValidPosition ??
      this.lastKnownPosition ??
      (this.calculatedTotalDuration != null ? this.calculatedTotalDuration - Math.abs(this.lastValidDuration ?? 0) : 0);

    this.durationTimer = seed;
    this.durationTimerInterval = setInterval(() => {
      this.durationTimer++;
    }, 1000);
  }

  resetDurationTimer() {
    clearInterval(this.durationTimerInterval);
    this.durationTimerInterval = null;
    this.hasOnlyDurationCount = 0;
    this.durationTimer = 0;
    this.calculatedTotalDuration = null;
  }

  getDurationTimer() {
    return this.durationTimer;
  }
};
