const $ = (id) => document.getElementById(id);

const state = { voices: [], history: [] };

// Tab switching
$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  const tabId = btn.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tabId}`));
});

$('speed-range').addEventListener('input', (e) => {
  $('speed-val').textContent = e.target.value;
});

async function refreshData() {
  const [h, v, hist] = await Promise.all([
    fetch('/api/health').then((r) => r.json()),
    fetch('/api/voices').then((r) => r.json()),
    fetch('/api/history').then((r) => r.json()),
  ]);

  $('api-badge').textContent = h.ok ? 'API Online' : 'Offline';
  $('api-badge').classList.toggle('ok', Boolean(h.ok));
  $('llm-badge').textContent = `publik LLM: ${h.publikLlmConfigured ? 'Connected' : 'Local Fallback'}`;

  state.voices = v.voices || [];
  state.history = hist.history || [];

  const select = $('voice-select');
  const current = select.value;
  select.innerHTML = '';
  for (const voice of state.voices) {
    const opt = document.createElement('option');
    opt.value = voice.id;
    opt.textContent = `${voice.name} — ${voice.engine}`;
    select.appendChild(opt);
  }
  if (current && state.voices.some((x) => x.id === current)) select.value = current;

  renderHistory();
}

function renderHistory() {
  $('history-count').textContent = String(state.history.length);
  const list = $('history-list');
  list.innerHTML = '';
  if (state.history.length === 0) {
    list.innerHTML = '<p class="status">No generations yet.</p>';
    return;
  }
  for (const item of state.history) {
    const row = document.createElement('div');
    row.className = 'list-item';

    const info = document.createElement('div');
    info.style.flex = '1';
    info.style.minWidth = '240px';
    info.innerHTML = `<strong>${escapeHtml(item.voiceName)}</strong> <span class="badge">${escapeHtml(item.engine)}</span> ${item.watermarked ? '<span class="badge ok">Watermarked</span>' : ''}<div class="status" style="margin-top:4px">${escapeHtml(item.text)}</div>`;

    const controls = document.createElement('div');
    controls.className = 'row';

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = `/api/history/${item.id}/audio`;

    const dl = document.createElement('a');
    dl.className = 'secondary';
    dl.href = `/api/history/${item.id}/audio`;
    dl.download = item.filename;
    dl.textContent = 'Download';

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete';
    del.onclick = async () => {
      await fetch(`/api/history/${item.id}`, { method: 'DELETE' });
      await refreshData();
    };

    controls.append(audio, dl, del);
    row.append(info, controls);
    list.appendChild(row);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

let kokoroPromise = null;

async function getKokoro(onStatus) {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      onStatus?.('Loading Kokoro model in browser (first run ~80MB)...');
      const { KokoroTTS } = await import('https://esm.sh/kokoro-js@1.2.1');
      const device = navigator.gpu ? 'webgpu' : 'wasm';
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device });
    })().catch((err) => {
      kokoroPromise = null;
      throw err;
    });
  }
  return kokoroPromise;
}

function encodePcm16Wav(samples, sampleRate = 24000) {
  const dataSize = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function synthesizeWithFallback({ text, voiceId, speed, onStatus }) {
  const voice = state.voices.find((v) => v.id === voiceId);
  const engine = voice?.engine || 'kokoro';

  if (engine === 'kokoro') {
    try {
      const tts = await getKokoro(onStatus);
      onStatus?.('Synthesizing speech in browser (Kokoro)...');
      const kokoroVoice = voice?.blend?.[0]?.voiceId || voiceId;
      const raw = await tts.generate(text, { voice: kokoroVoice, speed });
      const wavBlob = encodePcm16Wav(raw.audio, raw.sampling_rate || 24000);
      onStatus?.('Watermarking & saving to history...');
      const form = new FormData();
      form.append('audio', wavBlob, 'kokoro.wav');
      form.append('text', text);
      form.append('voiceId', voiceId);
      form.append('voiceName', voice?.name || voiceId);
      form.append('engine', 'kokoro');
      const res = await fetch('/api/history/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data;
    } catch (err) {
      onStatus?.(`Browser Kokoro unavailable (${err.message}); falling back to server...`);
    }
  }

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId, speed }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Generation failed');
  return data;
}

async function generateSpeech(overrideText, overrideVoiceId, overrideSpeed) {
  $('btn-generate').disabled = true;
  $('studio-status').textContent = 'Starting synthesis...';
  try {
    const data = await synthesizeWithFallback({
      text: overrideText ?? $('tts-text').value,
      voiceId: overrideVoiceId ?? $('voice-select').value,
      speed: overrideSpeed ?? Number($('speed-range').value),
      onStatus: (msg) => { $('studio-status').textContent = msg; },
    });
    const audio = $('studio-audio');
    audio.src = data.audioUrl;
    audio.classList.remove('hidden');
    audio.play().catch(() => {});
    $('studio-status').textContent = `Generated (${data.entry.engine} / ${data.entry.mode}) — watermarked & saved to history.`;
    await refreshData();
  } catch (err) {
    $('studio-status').textContent = `Error: ${err.message}`;
  } finally {
    $('btn-generate').disabled = false;
  }
}

$('btn-generate').addEventListener('click', () => generateSpeech());

$('btn-direct').addEventListener('click', async () => {
  const text = $('tts-text').value.trim();
  if (!text) return;
  const res = await fetch('/api/llm/direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (data.directed) $('tts-text').value = data.directed;
});

$('btn-translate').addEventListener('click', async () => {
  const text = $('tts-text').value.trim();
  if (!text) return;
  const res = await fetch('/api/llm/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLanguage: $('translate-lang').value }),
  });
  const data = await res.json();
  if (data.translated) $('tts-text').value = data.translated;
});

$('btn-write').addEventListener('click', async () => {
  const topic = $('write-topic').value.trim();
  if (!topic) return;
  const res = await fetch('/api/llm/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  const data = await res.json();
  if (data.script) {
    $('tts-text').value = data.script;
    await generateSpeech(data.script);
  }
});

$('btn-design').addEventListener('click', async () => {
  const description = $('design-prompt').value.trim();
  if (!description) return;
  $('design-status').textContent = 'Designing voice with LLM...';
  const res = await fetch('/api/voices/design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  const data = await res.json();
  $('design-status').textContent =
    `Settings (${data.provider}): ` + Object.entries(data.settings).map(([k, v]) => `${k}=${v}`).join(' · ');

  const container = $('design-results');
  container.innerHTML = '';
  for (const v of data.variations) {
    const item = document.createElement('div');
    item.className = 'list-item';

    const info = document.createElement('div');
    info.innerHTML = `<strong>${escapeHtml(v.label)}</strong><div class="status" style="margin-top:2px">"${escapeHtml(v.sampleLine)}"</div>`;

    const actions = document.createElement('div');
    actions.className = 'row';

    const preview = document.createElement('button');
    preview.className = 'secondary';
    preview.textContent = 'Preview';
    preview.onclick = async () => {
      const d = await synthesizeWithFallback({
        text: v.sampleLine,
        voiceId: v.voiceId,
        speed: v.speed,
        onStatus: (msg) => { $('design-status').textContent = msg; },
      });
      if (d.audioUrl) {
        const audio = $('design-audio');
        audio.src = d.audioUrl;
        audio.classList.remove('hidden');
        audio.play().catch(() => {});
        await refreshData();
      }
    };

    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Save to Library';
    save.onclick = async () => {
      const name = `${description.slice(0, 24).trim()} (${v.label.split('—')[0].trim()})`;
      const r = await fetch('/api/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          engine: v.engine,
          description,
          settings: data.settings,
          blend: v.blend,
        }),
      });
      if (r.ok) {
        $('design-status').textContent = `Saved "${name}" to your voice library.`;
        await refreshData();
      }
    };

    actions.append(preview, save);
    item.append(info, actions);
    container.appendChild(item);
  }
});

$('clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('clone-status').textContent = '';
  const form = new FormData();
  form.append('name', $('clone-name').value);
  form.append('consentConfirmed', String($('clone-confirm').checked));
  if ($('clone-sample').files?.[0]) form.append('sampleAudio', $('clone-sample').files[0]);
  if ($('clone-consent').files?.[0]) form.append('consentAudio', $('clone-consent').files[0]);

  const res = await fetch('/api/voices/clone', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) {
    $('clone-status').textContent = `Error: ${data.error}`;
    return;
  }
  $('clone-status').textContent = `Cloned voice "${data.voice.name}" saved with verified consent.`;
  $('clone-form').reset();
  await refreshData();
});

$('agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const transcript = $('agent-input').value.trim();
  if (!transcript) return;
  $('agent-input').value = '';
  const res = await fetch('/api/agent/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      systemPrompt: $('agent-prompt').value,
      voiceId: $('voice-select').value,
    }),
  });
  const data = await res.json();
  const card = document.createElement('div');
  card.className = 'list-item';
  card.style.display = 'block';
  card.innerHTML = `<div><strong>You:</strong> ${escapeHtml(transcript)}</div><div style="margin:6px 0"><strong>Agent:</strong> ${escapeHtml(data.reply)}</div>`;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = data.audioUrl;
  audio.style.width = '100%';
  card.appendChild(audio);
  $('agent-log').appendChild(card);
  audio.play().catch(() => {});
  await refreshData();
});

$('btn-stt').addEventListener('click', () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Browser SpeechRecognition is not supported in this browser. Type your message instead.');
    return;
  }
  const rec = new SR();
  rec.lang = 'en-US';
  $('btn-stt').textContent = 'Listening...';
  rec.onresult = (ev) => {
    $('agent-input').value = ev.results?.[0]?.[0]?.transcript || '';
    $('btn-stt').textContent = 'Mic (STT)';
  };
  rec.onerror = () => { $('btn-stt').textContent = 'Mic (STT)'; };
  rec.onend = () => { $('btn-stt').textContent = 'Mic (STT)'; };
  rec.start();
});

$('verify-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('audio', file);
  const res = await fetch('/api/watermark/verify', { method: 'POST', body: form });
  const data = await res.json();
  const pre = $('verify-result');
  pre.textContent = JSON.stringify(data, null, 2);
  pre.classList.remove('hidden');
});

refreshData().catch((err) => {
  $('studio-status').textContent = `Failed to connect to API: ${err.message}`;
});
