const stopped = () => new Error('Stopped.');

/**
 * One line for everything that needs the graphics card (local pictures and local 3D): first in, first out, one run at a
 * time. `prepare(signal)` runs before each turn, best effort; a failure there never fails the run.
 */
export function createGpuQueue({ prepare } = {}) {
  const waiting = [];
  let busy = false;
  // A listener that throws (its window is gone) must not hold up the other runs.
  const tell = (item, ahead) => { try { item.onWait?.(ahead); } catch { /* nobody is listening */ } };
  const tellAll = () => { [...waiting].forEach((item, index) => tell(item, index + 1)); };

  async function drain() {
    busy = true;
    for (let item; (item = waiting.shift());) {
      const { task, signal, leave, resolve, reject, queued } = item;
      signal?.removeEventListener('abort', leave);
      if (queued) tell(item, 0);
      tellAll();
      try { await prepare?.(signal); } catch { /* the run may still work */ }
      try {
        if (signal?.aborted) throw stopped();
        resolve(await task());
      } catch (cause) {
        reject(cause);
      }
    }
    busy = false;
  }

  return {
    /**
     * Runs `task` when its turn comes; the next run starts once its promise settles, so it must settle only when its
     * process is gone (see `whenGone`). `onWait(ahead)` hears how many runs are ahead while waiting, then 0 when a run
     * that waited starts. Aborting `signal` while waiting rejects at once; after that, stopping is up to the task.
     */
    run(task, { signal, onWait } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(stopped()); return; }
        const item = {
          task, signal, onWait, resolve, reject, queued: busy,
          leave() { waiting.splice(waiting.indexOf(item), 1); reject(stopped()); tellAll(); },
        };
        signal?.addEventListener('abort', item.leave, { once: true });
        waiting.push(item);
        if (busy) tell(item, waiting.length); else void drain();
      });
    },
  };
}

/**
 * Resolves with the exit code once a child process is really gone, or rejects if it never started. A failed kill also
 * emits 'error' but leaves the process running, so only a process without a pid counts as not started. Python in a venv is
 * a launcher with the worker behind it on the same pipes, so this also waits (at most `closeMs`) for the pipes to close.
 */
export function whenGone(proc, closeMs = 10_000) {
  return new Promise((resolve, reject) => {
    proc.on('error', (cause) => { if (proc.pid === undefined) reject(cause); });
    proc.on('exit', (code) => {
      if (proc.stdout?.closed !== false && proc.stderr?.closed !== false) { resolve(code); return; }
      const timer = setTimeout(() => resolve(code), closeMs);
      proc.on('close', () => { clearTimeout(timer); resolve(code); });
    });
  });
}
