/**
 * Web Audio API Sound Generator for POS Notifications
 * Plays acoustic double/triple-chimes without needing any external audio files.
 */

let sharedAudioContext = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      sharedAudioContext = new AudioContextClass();
    }
  }
  if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

// Automatically resume audio context on first user interaction to satisfy browser autoplay policy
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { once: true });
  window.addEventListener('touchstart', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

/**
 * Play a notification chime
 * @param {'incoming' | 'upcoming'} type 
 * @param {boolean} isSlip - true if payment slip was uploaded
 */
export function playNotificationSound(type = 'incoming', isSlip = false) {
  try {
    const isSoundEnabled = localStorage.getItem('bwork_sound_enabled') !== 'false';
    if (!isSoundEnabled) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (type === 'incoming') {
      if (isSlip) {
        // High-pitch 3-tone chime for Payment Slip arrival (A5 -> C#6 -> E6)
        const notes = [880, 1108.73, 1318.51];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);
          
          gain.gain.setValueAtTime(0.28, now + idx * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.35);
        });
      } else {
        // Pleasant 2-tone chime for New Online Booking (D5 -> A5)
        const notes = [587.33, 880];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.14);
          
          gain.gain.setValueAtTime(0.28, now + idx * 0.14);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.4);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.14);
          osc.stop(now + idx * 0.14 + 0.4);
        });
      }
    } else if (type === 'upcoming') {
      // Gentle reminder alert for Meeting Near Start Time (E5 -> G5)
      const notes = [659.25, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.16);
        
        gain.gain.setValueAtTime(0.22, now + idx * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.3);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.16);
        osc.stop(now + idx * 0.16 + 0.3);
      });
    }
  } catch (err) {
    console.warn('[Sound] Failed to play notification chime:', err);
  }
}
