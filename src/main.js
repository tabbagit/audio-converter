
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import '../style.css';

const $ = (id) => document.getElementById(id);
const rates = ['44100', '48000', '88200', '96000', '176400', '192000'];

let ffmpeg;
let ready = false;
let busy = false;
let cancelRequested = false;

const opts = (items, selected) => items.map(([value, label]) =>
  `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`
).join('');

function field(label, id, items, selected) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts(items, selected)}</select></div>`;
}

function renderSettings() {
  const format = $('format').value;
  let html = '';

  const sampleRates = rates.map(value => [value, `${Number(value) / 1000} kHz`]);
  const bitrates = ['96', '128', '160', '192', '256', '320'].map(value => [value, `${value} kbps`]);

  if (format === 'WAV') {
    html = field('Bit depth', 'depth', [['16', '16-bit'], ['24', '24-bit'], ['32', '32-bit']], '24')
      + field('Sample rate', 'rate', sampleRates, '44100');
  } else if (format === 'MP3') {
    html = field('Bitrate', 'bitrate', bitrates, '320')
      + field('Sample rate', 'rate', [['32000', '32 kHz'], ['44100', '44.1 kHz'], ['48000', '48 kHz']], '44100');
  } else if (format === 'FLAC') {
    html = field('Bit depth', 'depth', [['16', '16-bit'], ['24', '24-bit']], '24')
      + field('Compression level', 'compression', Array.from({ length: 9 }, (_, i) => [String(i), String(i)]), '5')
      + field('Sample rate', 'rate', sampleRates, '44100');
  } else if (format === 'AAC') {
    html = field('Bitrate', 'bitrate', bitrates, '192')
      + field('Sample rate', 'rate', [['44100', '44.1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz']], '44100');
  }

  $('settings').innerHTML = html;
}

function setStatus(message) {
  $('status').textContent = message;
}

function updateConvertButton() {
  $('convert').disabled = !ready || busy || !$('file').files.length;
}

$('format').addEventListener('change', renderSettings);
renderSettings();

$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  $('fileInfo').textContent = file?.name || 'Choose an audio file...';
  updateConvertButton();
});

async function init() {
  try {
    setStatus('Se descarcă motorul FFmpeg (prima încărcare poate dura)...');

    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      const percent = Math.max(0, Math.min(99, Math.round(progress * 100)));
      $('progress').value = percent;
      $('percent').textContent = `${percent}%`;
    });

    // Vite requires the ESM version of FFmpeg Core.
    const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

    const coreURL = await toBlobURL(
      `${coreBase}/ffmpeg-core.js`,
      'text/javascript'
    );

    const wasmURL = await toBlobURL(
      `${coreBase}/ffmpeg-core.wasm`,
      'application/wasm'
    );

    await ffmpeg.load({
      coreURL,
      wasmURL
    });

    ready = true;

    setStatus('Motor FFmpeg încărcat. Selectează fișierul și formatul dorit.');

    updateConvertButton();

  } catch (error) {
    console.error('FFmpeg initialization failed:', error);
    setStatus(`Eroare la încărcarea FFmpeg: ${error?.message || error}`);
  }
}

$('cancel').addEventListener('click', () => {
  if (!busy) return;

  cancelRequested = true;

  setStatus('Anularea va fi verificată după operația FFmpeg curentă...');
});

$('convert').addEventListener('click', async () => {
  const file = $('file').files[0];

  if (!file || !ready || busy) return;

  busy = true;
  cancelRequested = false;

  updateConvertButton();

  $('cancel').disabled = false;
  $('progress').value = 0;
  $('percent').textContent = '0%';

  const format = $('format').value;

  const extension = {
    WAV: 'wav',
    MP3: 'mp3',
    FLAC: 'flac',
    AAC: 'm4a'
  }[format];

  const inputName = `input.${(file.name.split('.').pop() || 'audio').toLowerCase()}`;
  const outputName = `converted.${extension}`;

  const args = [
    '-i', inputName,
    '-map', '0:a:0',
    '-vn',
    '-map_metadata', '0'
  ];

  if (format === 'WAV') {
    const codec = {
      '16': 'pcm_s16le',
      '24': 'pcm_s24le',
      '32': 'pcm_s32le'
    }[$('depth').value];

    args.push(
      '-c:a', codec,
      '-ar', $('rate').value,
      '-f', 'wav'
    );

  } else if (format === 'MP3') {
    args.push(
      '-c:a', 'libmp3lame',
      '-b:a', `${$('bitrate').value}k`,
      '-ar', $('rate').value,
      '-f', 'mp3'
    );

  } else if (format === 'FLAC') {
    const depth = $('depth').value;

    args.push(
      '-c:a', 'flac',
      '-sample_fmt', depth === '16' ? 's16' : 's32',
      '-bits_per_raw_sample', depth,
      '-compression_level', $('compression').value,
      '-ar', $('rate').value,
      '-f', 'flac'
    );

  } else if (format === 'AAC') {
    args.push(
      '-c:a', 'aac',
      '-profile:a', 'aac_low',
      '-b:a', `${$('bitrate').value}k`,
      '-ar', $('rate').value,
      '-movflags', '+faststart',
      '-f', 'ipod'
    );
  }

  args.push(outputName);

  try {
    setStatus('Se pregătește fișierul...');

    await ffmpeg.writeFile(
      inputName,
      new Uint8Array(await file.arrayBuffer())
    );

    if (cancelRequested) {
      throw new Error('Conversie anulată.');
    }

    setStatus('Conversie în curs...');

    await ffmpeg.exec(args);

    if (cancelRequested) {
      throw new Error('Conversie anulată.');
    }

    const data = await ffmpeg.readFile(outputName);

    const mime = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
      m4a: 'audio/mp4'
    }[extension];

    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;
    link.download = file.name.replace(/\.[^.]+$/, '') + `.${extension}`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);

    $('progress').value = 100;
    $('percent').textContent = '100%';

    setStatus('Conversie finalizată. Descărcarea a fost inițiată.');

  } catch (error) {
    console.error('Conversion failed:', error);
    setStatus(error?.message || 'Conversia a eșuat.');

  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {}

    try {
      await ffmpeg.deleteFile(outputName);
    } catch {}

    busy = false;

    $('cancel').disabled = true;

    updateConvertButton();
  }
});

init();
