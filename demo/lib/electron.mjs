// Starts Electron (running Firn) and runs code in its main process, through
// Node's built-in inspector: the same channel Playwright's Electron support
// uses, without Playwright's tracking of every page.
//
// Why not Playwright itself: when Playwright starts an Electron app, it
// waits for every page that exists to finish setting up. Firn keeps
// restored tabs unloaded until they're first opened, and such a page never
// sets up, so Playwright could wait forever (whether it does depends on
// timing). The demo only needs the main process, so it talks to it
// directly. The inspector listens on this computer only, on a random
// port, and only while the demo runs.

import { spawn } from 'node:child_process';

// `app.evaluate(fn, arg)` runs `fn(electron, arg)` in the main process and
// resolves to its result (anything JSON can carry); `app.process()` is the
// Electron process.
export async function launchElectron({ executablePath, args, cwd, env }) {
  const child = spawn(executablePath, ['--inspect=0', ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // The last part of what Electron prints (for working out problems).
  let output = '';
  // Electron quitting while the demo is connected waits for it to let go
  // ("Waiting for the debugger to disconnect"): then it has ended.
  let ended = false;
  let letGo = () => {};
  const keep = (chunk) => {
    output = (output + chunk).slice(-50_000);
    if (!ended && /Waiting for the debugger to disconnect/.test(output)) {
      ended = true;
      letGo();
    }
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const url = await new Promise((resolve, reject) => {
    let log = '';
    const onData = (chunk) => {
      log += chunk;
      const match = /Debugger listening on (ws:\/\/\S+)/.exec(log);
      if (match) {
        child.stderr.off('data', onData);
        resolve(match[1]);
      }
    };
    child.stderr.on('data', onData);
    child.once('exit', () =>
      reject(new Error(`Firn stopped while starting:\n${log.slice(-1500)}`)),
    );
  });

  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('Couldn’t reach Firn.')),
      {
        once: true,
      },
    );
  });
  let nextId = 1;
  const pending = new Map();
  let resolveContext;
  const context = new Promise((resolve) => (resolveContext = resolve));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.executionContextCreated') {
      if (message.params.context.auxData?.isDefault)
        resolveContext(message.params.context.id);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  const closed = () => {
    for (const { reject } of pending.values())
      reject(new Error('Firn closed.'));
    pending.clear();
  };
  socket.addEventListener('close', closed);
  child.once('exit', () => {
    ended = true;
    socket.close();
  });
  letGo = () => socket.close();
  if (ended) socket.close();

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN)
        return reject(new Error('Firn closed.'));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable', {});
  const contextId = await context;

  // Electron's API, through Firn's own main program. (Not the
  // inspector's own require('electron'): asked before Electron has set
  // itself up, that gives the npm package, a file path, and Node then
  // remembers that answer for it for good.) Wait until it's there.
  const ELECTRON = `(process.mainModule && process.mainModule.require('electron'))`;
  for (let i = 0; ; i++) {
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => { const e = ${ELECTRON}; return typeof e === 'object' && !!e && !!e.app && !!e.BrowserWindow; })()`,
      contextId,
      returnByValue: true,
    }).catch(() => ({ result: {} }));
    if (result?.value === true) break;
    if (ended || i > 600)
      throw new Error(
        `Electron didn’t finish starting.\n${output.slice(-1500)}`,
      );
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    process: () => child,
    output: () => output,
    // Firn has quit (or is quitting).
    ended: () => ended || child.exitCode !== null,
    async evaluate(fn, arg) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(${fn.toString()})(${ELECTRON}, ${JSON.stringify(arg ?? null)})`,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails)
        throw new Error(
          exceptionDetails.exception?.description ?? exceptionDetails.text,
        );
      return result.value;
    },
  };
}
