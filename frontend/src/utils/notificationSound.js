/**
 * Native Web Audio API Synthesizer for Staff Live Notifications
 *
 * Synthesizes professional, non-intrusive chimes without external audio files.
 * - NORMAL: Dual-tone chime (D5 587Hz -> A5 880Hz, gentle exponential decay)
 * - IMPORTANT: Triple-tone harmonic chime (C5 523Hz -> E5 659Hz -> G5 784Hz)
 * - Rate-limited to max 1 sound per 1.5s (important sound takes priority)
 * - Gesture unlock: automatically resumes AudioContext on user interaction
 */

let audioCtx = null;
let isAudioReady = false;
let lastSoundTime = 0;
const SOUND_COOLDOWN_MS = 1500;

function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  return audioCtx;
}

/**
 * Attempts to resume or initialize AudioContext on user gesture.
 * Resolves safely without throwing if autoplay is restricted.
 */
export async function unlockAudioContext() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (ctx.state === 'running') {
      isAudioReady = true;
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

export function isAudioUnlocked() {
  if (typeof window === 'undefined') return false;
  const ctx = getAudioContext();
  return Boolean(ctx && ctx.state === 'running');
}

/**
 * Synthesizes a pure chime note.
 */
function playTone(ctx, freq, startTime, duration, gainValue = 0.15) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  // Smooth attack & exponential decay
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

/**
 * Plays a notification chime based on soundClass ('normal' | 'important').
 * Rate-limits playback to prevent overlapping sounds.
 */
export function playNotificationSound(soundClass = 'normal', force = false) {
  if (typeof window === 'undefined') return;

  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') {
    return;
  }

  const now = Date.now();
  if (!force && now - lastSoundTime < SOUND_COOLDOWN_MS) {
    return;
  }
  lastSoundTime = now;

  const t = ctx.currentTime + 0.02;

  try {
    if (soundClass === 'important') {
      // Triple-tone harmonic chime (C5 -> E5 -> G5)
      playTone(ctx, 523.25, t, 0.18, 0.18);
      playTone(ctx, 659.25, t + 0.10, 0.18, 0.18);
      playTone(ctx, 783.99, t + 0.20, 0.35, 0.22);
    } else {
      // Normal dual-tone chime (D5 -> A5)
      playTone(ctx, 587.33, t, 0.14, 0.14);
      playTone(ctx, 880.00, t + 0.10, 0.28, 0.18);
    }
  } catch (e) {
    // Ignore audio playback errors safely
  }
}

// Auto-register first-gesture listener once
if (typeof window !== 'undefined') {
  const handleFirstGesture = () => {
    unlockAudioContext().then(() => {
      window.removeEventListener('pointerdown', handleFirstGesture, true);
      window.removeEventListener('keydown', handleFirstGesture, true);
      window.removeEventListener('click', handleFirstGesture, true);
    });
  };

  window.addEventListener('pointerdown', handleFirstGesture, true);
  window.addEventListener('keydown', handleFirstGesture, true);
  window.addEventListener('click', handleFirstGesture, true);
}
