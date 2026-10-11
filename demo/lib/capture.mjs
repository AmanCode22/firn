// Recording the screen where Firn's window is, and taking stills.
//
// Why the screen and not Playwright's own video: Firn's web pages are
// separate views (WebContentsView) laid over its window, each with its own
// renderer. Playwright records one renderer at a time, so its video would
// show the sidebar with a blank hole where the page is. Recording the
// screen captures exactly what's shown: the sidebar, the page, panels,
// menus, and the demo cursor.
//
// macOS (the real thing): ffmpeg's AVFoundation screen capture, cropped to
// the window, at the screen's full (Retina) resolution, 60 frames a
// second, without the system's pointer. It's first saved quickly with the
// Mac's hardware encoder, then trimmed and encoded at high quality (H.264,
// CRF 14, yuv420p). Stills: macOS's `screencapture` of Firn's window
// alone, at full resolution (no demo cursor, no shadow).
//
// Linux (for trying the recorder in a development container): X11 screen
// capture of the same region.

import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FPS = 60;

// Recordings that are still going, so a failed clip or a stopped run can
// end them. (A recording left running holds the screen, and every later
// ffmpeg that asks for it waits forever.)
const recordings = new Set();

// Ends every recording that's still going (without saving). ffmpeg can
// ignore a polite stop while it's waiting on the screen, so it's killed.
export function stopAllRecordings() {
  for (const ffmpeg of recordings) ffmpeg.kill('SIGKILL');
  recordings.clear();
}

// Ends recordings a previous run left behind (they write into this run's
// `rawFolder`, so they're the demo's own).
export function stopStrayRecordings(rawFolder) {
  try {
    const pids = execFileSync('pgrep', ['-f', `ffmpeg.*${rawFolder}`], {
      encoding: 'utf8',
    })
      .split('\n')
      .map(Number)
      .filter((pid) => pid && pid !== process.pid);
    for (const pid of pids) {
      console.log(`[demo]   stopping a leftover recording (${pid})`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  } catch {
    // pgrep found nothing.
  }
}

// What to say when macOS doesn't let ffmpeg record the screen (it waits,
// silently, until Screen Recording is allowed).
const PERMISSION = `macOS didn’t let ffmpeg record the screen. In System Settings > Privacy & Security > Screen & System Audio Recording, turn on your Terminal app (or allow it in the prompt, which may be behind other windows). Then quit Terminal completely (Cmd+Q), reopen it, and run the demo again.`;
const LIMIT = 20_000;
// ffmpeg didn't answer in time: most likely the permission, and what it
// said, in case it's something else.
const stuck = (said = '') =>
  `${PERMISSION}\n\n(What ffmpeg said:\n${String(said).trim().slice(-1200) || 'nothing'})`;

export function checkTools() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'ffmpeg isn’t installed. On a Mac: brew install ffmpeg (see demo/README.md).',
    );
  }
  if (process.platform !== 'darwin' && process.platform !== 'linux')
    throw new Error(
      'The demo recorder runs on macOS (and Linux, for testing).',
    );
  if (process.platform === 'linux' && !process.env.DISPLAY)
    throw new Error('On Linux, the demo needs an X display (DISPLAY).');
}

// The AVFoundation device number of the main screen ("Capture screen 0").
async function macScreenDevice() {
  const result = await run(
    'ffmpeg',
    ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    { encoding: 'utf8', timeout: LIMIT, killSignal: 'SIGKILL' },
  ).catch((error) => error);
  if (result.killed) throw new Error(stuck(result.stderr));
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /\[(\d+)\] Capture screen 0/.exec(text);
  if (!match)
    throw new Error(
      'ffmpeg can’t see the screen. Give your Terminal app Screen Recording permission (see demo/README.md).',
    );
  return match[1];
}

// A short throwaway recording, before anything is on screen. Newer macOS
// asks separately (a dialog in the middle of the screen, "…is requesting
// to bypass the system private window picker…") the first time a
// recording starts; this makes it ask now, not over a clip.
export async function warmUpScreen() {
  if (process.platform !== 'darwin') return;
  const device = await macScreenDevice();
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-f',
      'avfoundation',
      '-framerate',
      String(FPS),
      '-i',
      `${device}:none`,
      '-t',
      '2',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', timeout: LIMIT, killSignal: 'SIGKILL' },
  ).catch(() => {});
}

// Pixels per point in the recording. On a Mac it's measured: macOS
// records a scaled screen (e.g. a 4K display at "looks like 2560×1440")
// at its own size, which isn't always twice the points. `display` is the
// main screen in points; elsewhere, Electron's `scale` is used.
export async function captureScale(display, scale) {
  if (process.platform !== 'darwin') return scale;
  const device = await macScreenDevice();
  const result = await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-f',
      'avfoundation',
      '-framerate',
      String(FPS),
      '-i',
      `${device}:none`,
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', timeout: LIMIT, killSignal: 'SIGKILL' },
  ).catch((error) => error);
  if (result.killed) throw new Error(stuck(result.stderr));
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const size = /Video: [^\n]*?(\d{3,5})x(\d{3,5})/.exec(text);
  if (!size)
    throw new Error(`ffmpeg couldn’t record the screen:\n${text.slice(-1500)}`);
  return Number(size[1]) / display.width;
}

// Starts recording `region` (the window, in screen points; `scale` pixels
// per point). Resolves once frames are arriving, with `stop()`, which
// resolves to { file, startedAt } (when its first frame was taken, by
// this computer's clock).
export async function startRecording(region, scale, rawFile) {
  fs.rmSync(rawFile, { force: true });
  const px = (n) => Math.round(n * scale);
  const even = (n) => n - (n % 2);
  const w = even(px(region.width));
  const h = even(px(region.height));
  let args;
  if (process.platform === 'darwin') {
    const device = await macScreenDevice();
    args = [
      '-hide_banner',
      '-f',
      'avfoundation',
      '-capture_cursor',
      '0',
      '-capture_mouse_clicks',
      '0',
      '-framerate',
      String(FPS),
      '-i',
      `${device}:none`,
      '-vf',
      `crop=${w}:${h}:${px(region.x)}:${px(region.y)}`,
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      '120M',
      '-r',
      String(FPS),
      rawFile,
    ];
  } else {
    args = [
      '-hide_banner',
      '-f',
      'x11grab',
      '-draw_mouse',
      '0',
      '-framerate',
      String(FPS),
      '-video_size',
      `${w}x${h}`,
      '-i',
      `${process.env.DISPLAY}+${region.x},${region.y}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '10',
      rawFile,
    ];
  }
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  recordings.add(ffmpeg);
  ffmpeg.on('exit', () => recordings.delete(ffmpeg));
  let log = '';
  let startedAt = 0;
  const started = new Promise((resolve, reject) => {
    ffmpeg.stderr.on('data', (chunk) => {
      log += chunk;
      const frames = /frame=\s*(\d+)/.exec(String(chunk));
      if (!startedAt && frames && Number(frames[1]) > 0) {
        startedAt = Date.now() - (Number(frames[1]) / FPS) * 1000;
        resolve();
      }
    });
    ffmpeg.on('exit', () =>
      reject(
        new Error(`The screen recording didn’t start:\n${log.slice(-1500)}`),
      ),
    );
    setTimeout(() => {
      if (startedAt) return;
      ffmpeg.removeAllListeners('exit');
      recordings.delete(ffmpeg);
      ffmpeg.kill('SIGKILL');
      reject(new Error(stuck(log)));
    }, LIMIT);
  });
  await started;
  return {
    // Ends the recording and saves it. (If ffmpeg doesn't finish within
    // 15 seconds, it's killed, and what it saved so far is used.)
    stop: () =>
      new Promise((resolve, reject) => {
        ffmpeg.removeAllListeners('exit');
        const late = setTimeout(() => ffmpeg.kill('SIGKILL'), 15_000);
        ffmpeg.on('exit', () => {
          clearTimeout(late);
          recordings.delete(ffmpeg);
          fs.existsSync(rawFile)
            ? resolve({ file: rawFile, startedAt })
            : reject(
                new Error(`The recording wasn’t saved:\n${log.slice(-1500)}`),
              );
        });
        ffmpeg.stdin.write('q');
      }),
  };
}

// The finished clip: `from` to `to` (this computer's clock) of the
// recording, encoded for keeps.
export async function finishClip({ file, startedAt }, from, to, outFile) {
  const start = Math.max(0, (from - startedAt) / 1000);
  const length = (to - from) / 1000;
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    file,
    '-ss',
    start.toFixed(3),
    '-t',
    length.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '14',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FPS),
    '-movflags',
    '+faststart',
    '-an',
    outFile,
  ]);
}

// A still of Firn's window. On a Mac, `windowId` is its window number
// (macOS captures it alone, at full resolution); elsewhere the region.
export async function takeStill({ windowId, region }, outFile) {
  if (process.platform === 'darwin') {
    await run('screencapture', ['-x', '-o', '-l', String(windowId), outFile]);
  } else {
    await run('import', [
      '-window',
      'root',
      '-crop',
      `${region.width}x${region.height}+${region.x}+${region.y}`,
      outFile,
    ]);
  }
}
