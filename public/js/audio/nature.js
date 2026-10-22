// Procedural Web Audio synthesis for the Nature soundscape.
// Generates wind, stream, waves, crickets, and birds using zero audio files.
// Shuts down generators when volume is zero or paused to consume 0 CPU.

function smooth(param, value, context, time = 0.05) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  if (value === 0) {
    param.setValueAtTime(0, now);
  } else {
    param.setTargetAtTime(value, now, time);
  }
}

export function perceptual(value) {
  return value <= 0 ? 0 : value ** 2;
}

// Shared 5-second white noise buffer for noise-based generators (wind, stream, waves)
let sharedNoiseBuffer = null;
function getSharedNoiseBuffer(context) {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === context.sampleRate) {
    return sharedNoiseBuffer;
  }
  const length = context.sampleRate * 5;
  sharedNoiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = sharedNoiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return sharedNoiseBuffer;
}

/**
 * Wind generator: Looping noise buffer -> bandpass filter (~400 Hz) with slow
 * random modulation of center frequency and gain.
 */
function createWindGenerator(context, destination) {
  let source = null;
  let filter = null;
  let modGain = null;
  let timer = null;
  let running = false;

  function modulate() {
    if (!running || context.state === "closed") return;
    const now = context.currentTime;
    // Slow random modulation of frequency (300-500 Hz) and subtle gain
    const nextFreq = 300 + Math.random() * 220;
    const nextGain = 0.6 + Math.random() * 0.45;
    filter.frequency.setTargetAtTime(nextFreq, now, 1.4);
    modGain.gain.setTargetAtTime(nextGain, now, 1.2);
    timer = setTimeout(modulate, 2200 + Math.random() * 1800);
  }

  return {
    start() {
      if (running) return;
      running = true;
      const noise = getSharedNoiseBuffer(context);
      source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;

      filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 400;
      filter.Q.value = 1.6;

      modGain = context.createGain();
      modGain.gain.value = 0.8;

      source.connect(filter).connect(modGain).connect(destination);
      source.start(0);
      modulate();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        source?.stop();
        source?.disconnect();
        filter?.disconnect();
        modGain?.disconnect();
      } catch {}
      source = null;
      filter = null;
      modGain = null;
    },
  };
}

/**
 * Stream generator: Noise -> band-pass around 2-3 kHz with fast subtle gain ripples.
 */
function createStreamGenerator(context, destination) {
  let source = null;
  let bpFilter = null;
  let hpFilter = null;
  let rippleGain = null;
  let lfo = null;
  let lfoGain = null;
  let running = false;

  return {
    start() {
      if (running) return;
      running = true;
      const noise = getSharedNoiseBuffer(context);
      source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;

      // Bandpass around 2.4 kHz for bubbling water character
      bpFilter = context.createBiquadFilter();
      bpFilter.type = "bandpass";
      bpFilter.frequency.value = 2400;
      bpFilter.Q.value = 1.3;

      // Highpass around 900 Hz to cut rumble
      hpFilter = context.createBiquadFilter();
      hpFilter.type = "highpass";
      hpFilter.frequency.value = 900;

      // Ripple gain modulated by fast LFO (~5.5 Hz)
      rippleGain = context.createGain();
      rippleGain.gain.value = 0.85;

      lfo = context.createOscillator();
      lfo.frequency.value = 5.5; // Fast subtle water ripples

      lfoGain = context.createGain();
      lfoGain.gain.value = 0.15;

      lfo.connect(lfoGain).connect(rippleGain.gain);
      source.connect(hpFilter).connect(bpFilter).connect(rippleGain).connect(destination);

      source.start(0);
      lfo.start(0);
    },
    stop() {
      if (!running) return;
      running = false;
      try {
        source?.stop();
        source?.disconnect();
        lfo?.stop();
        lfo?.disconnect();
        lfoGain?.disconnect();
        hpFilter?.disconnect();
        bpFilter?.disconnect();
        rippleGain?.disconnect();
      } catch {}
      source = null;
      lfo = null;
      lfoGain = null;
      bpFilter = null;
      hpFilter = null;
      rippleGain = null;
    },
  };
}

/**
 * Waves generator: Noise -> low-pass filter, gain swelling slowly in and out
 * over about 8-10 seconds.
 */
function createWavesGenerator(context, destination) {
  let source = null;
  let lpFilter = null;
  let swellGain = null;
  let lfo = null;
  let lfoGain = null;
  let lfoFilterGain = null;
  let running = false;

  return {
    start() {
      if (running) return;
      running = true;
      const noise = getSharedNoiseBuffer(context);
      source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;

      lpFilter = context.createBiquadFilter();
      lpFilter.type = "lowpass";
      lpFilter.frequency.value = 450;
      lpFilter.Q.value = 1.1;

      swellGain = context.createGain();
      swellGain.gain.value = 0.5;

      // LFO at ~0.11 Hz (~9.1 second period)
      lfo = context.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.11;

      lfoGain = context.createGain();
      lfoGain.gain.value = 0.45;
      lfo.connect(lfoGain).connect(swellGain.gain);

      // Filter opens slightly as volume swells (like ocean spray)
      lfoFilterGain = context.createGain();
      lfoFilterGain.gain.value = 260;
      lfo.connect(lfoFilterGain).connect(lpFilter.frequency);

      source.connect(lpFilter).connect(swellGain).connect(destination);
      source.start(0);
      lfo.start(0);
    },
    stop() {
      if (!running) return;
      running = false;
      try {
        source?.stop();
        source?.disconnect();
        lfo?.stop();
        lfo?.disconnect();
        lfoGain?.disconnect();
        lfoFilterGain?.disconnect();
        lpFilter?.disconnect();
        swellGain?.disconnect();
      } catch {}
      source = null;
      lfo = null;
      lfoGain = null;
      lfoFilterGain = null;
      lpFilter = null;
      swellGain = null;
    },
  };
}

/**
 * Crickets generator: Multiple detuned oscillators around 4-5 kHz with gain
 * pulsed rapidly on/off via an LFO for organic insect texture.
 */
function createCricketsGenerator(context, destination) {
  let oscs = [];
  let bpFilter = null;
  let pulseGain = null;
  let pulseLfo = null;
  let pulseLfoGain = null;
  let cadenceTimer = null;
  let cadenceGain = null;
  let running = false;

  function scheduleCadence() {
    if (!running || context.state === "closed") return;
    const now = context.currentTime;
    // Crickets chirp in rhythmic bursts of 1.2-2.2 seconds followed by short pause
    const chirpDuration = 1.2 + Math.random() * 0.8;
    const pauseDuration = 0.4 + Math.random() * 0.6;
    cadenceGain.gain.setTargetAtTime(1, now, 0.08);
    cadenceGain.gain.setTargetAtTime(0.05, now + chirpDuration, 0.1);
    cadenceTimer = setTimeout(scheduleCadence, (chirpDuration + pauseDuration) * 1000);
  }

  return {
    start() {
      if (running) return;
      running = true;

      // 3 slightly detuned oscillators around 4.5 kHz
      const freqs = [4380, 4520, 4670];
      oscs = freqs.map((f) => {
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        return osc;
      });

      bpFilter = context.createBiquadFilter();
      bpFilter.type = "bandpass";
      bpFilter.frequency.value = 4500;
      bpFilter.Q.value = 3.0;

      pulseGain = context.createGain();
      pulseGain.gain.value = 0.5;

      // Rapid chirp pulse LFO (~18 Hz)
      pulseLfo = context.createOscillator();
      pulseLfo.type = "sine";
      pulseLfo.frequency.value = 18;

      pulseLfoGain = context.createGain();
      pulseLfoGain.gain.value = 0.5;
      pulseLfo.connect(pulseLfoGain).connect(pulseGain.gain);

      cadenceGain = context.createGain();
      cadenceGain.gain.value = 1;

      oscs.forEach((osc) => {
        osc.connect(bpFilter);
        osc.start(0);
      });
      pulseLfo.start(0);

      bpFilter.connect(pulseGain).connect(cadenceGain).connect(destination);
      scheduleCadence();
    },
    stop() {
      if (!running) return;
      running = false;
      if (cadenceTimer) {
        clearTimeout(cadenceTimer);
        cadenceTimer = null;
      }
      try {
        oscs.forEach((osc) => {
          osc.stop();
          osc.disconnect();
        });
        pulseLfo?.stop();
        pulseLfo?.disconnect();
        pulseLfoGain?.disconnect();
        bpFilter?.disconnect();
        pulseGain?.disconnect();
        cadenceGain?.disconnect();
      } catch {}
      oscs = [];
      pulseLfo = null;
      pulseLfoGain = null;
      bpFilter = null;
      pulseGain = null;
      cadenceGain = null;
    },
  };
}

/**
 * Birds generator: Short chirps with quick frequency sweep and gain envelope,
 * scheduled at varied intervals of 2 to 8 seconds with varied pitch.
 */
function createBirdsGenerator(context, destination) {
  let timer = null;
  let running = false;

  function chirp() {
    if (!running || context.state === "closed") return;
    const now = context.currentTime;

    // Varied base pitch between 2400 Hz and 3600 Hz
    const baseFreq = 2400 + Math.random() * 1200;
    const numNotes = Math.random() > 0.4 ? 2 : 1;

    for (let i = 0; i < numNotes; i++) {
      const noteOffset = i * (0.08 + Math.random() * 0.04);
      const noteStart = now + noteOffset;
      const noteDuration = 0.06 + Math.random() * 0.05;
      const sweepDirection = Math.random() > 0.4 ? 1 : -1;
      const freqSweep = sweepDirection * (300 + Math.random() * 500);

      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq + (i * 200), noteStart);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1000, baseFreq + freqSweep + (i * 200)),
        noteStart + noteDuration
      );

      const noteGain = context.createGain();
      noteGain.gain.setValueAtTime(0, noteStart);
      noteGain.gain.linearRampToValueAtTime(0.35, noteStart + noteDuration * 0.25);
      noteGain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDuration);

      osc.connect(noteGain).connect(destination);
      osc.start(noteStart);
      osc.stop(noteStart + noteDuration + 0.05);

      // Clean up single-shot nodes immediately after finishing
      osc.onended = () => {
        try {
          osc.disconnect();
          noteGain.disconnect();
        } catch {}
      };
    }

    // Schedule next chirp in 2 to 8 seconds
    const nextInterval = 2000 + Math.random() * 6000;
    timer = setTimeout(chirp, nextInterval);
  }

  return {
    start() {
      if (running) return;
      running = true;
      const firstChirpDelay = 1500 + Math.random() * 2500;
      timer = setTimeout(chirp, firstChirpDelay);
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Procedural layer factory exposing the identical interface as sample-based layers.
 * Connects generator -> trim -> layerGain -> driftGain -> panner -> channelGain.
 */
export function createProceduralLayer(context, layerConfig, channelGain, initialVolume, registerSource) {
  const trim = context.createGain();
  const layerGain = context.createGain();
  const driftGain = context.createGain();
  const panner = context.createStereoPanner();

  // Gain trim constant per layer (can be tuned via soundscapes.js gainDb)
  trim.gain.value = 10 ** (layerConfig.gainDb / 20);
  layerGain.gain.value = 0;
  driftGain.gain.value = 1;
  panner.pan.value = layerConfig.pan;

  // Layer chain
  trim.connect(layerGain).connect(driftGain).connect(panner).connect(channelGain);

  let generator = null;
  const id = layerConfig.id;

  if (id === "wind") {
    generator = createWindGenerator(context, trim);
  } else if (id === "stream") {
    generator = createStreamGenerator(context, trim);
  } else if (id === "waves") {
    generator = createWavesGenerator(context, trim);
  } else if (id === "crickets") {
    generator = createCricketsGenerator(context, trim);
  } else if (id === "birds") {
    generator = createBirdsGenerator(context, trim);
  }

  let target = perceptual(initialVolume);

  // If initial volume > 0 and context is running, activate generator
  if (target > 0 && context.state === "running") {
    generator?.start();
  }

  return {
    trim,
    layerGain,
    driftGain,
    panner,
    layer: layerConfig,
    target,
    setVolume(value, ramp = 0.05) {
      this.target = perceptual(value);
      smooth(layerGain.gain, this.target, context, ramp);

      // Stop generators when volume is 0 to consume 0 CPU
      if (this.target <= 0) {
        generator?.stop();
      } else if (context.state === "running") {
        generator?.start();
      }
    },
    startRamp() {
      smooth(layerGain.gain, this.target, context, 1.2);
      if (this.target > 0 && context.state === "running") {
        generator?.start();
      }
    },
    pause() {
      generator?.stop();
    },
    resume() {
      if (this.target > 0 && context.state === "running") {
        generator?.start();
      }
    },
    destroy() {
      generator?.stop();
      try {
        trim.disconnect();
        layerGain.disconnect();
        driftGain.disconnect();
        panner.disconnect();
      } catch {}
    },
  };
}

