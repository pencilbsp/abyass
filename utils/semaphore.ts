type Release = () => void;

/**
 * A fair, Promise-based semaphore that controls concurrent access.
 * Usage:
 *   const sem = new Semaphore(3);
 *   // Acquire a slot:
 *   const release = await sem.acquire();
 *   try {
 *     // critical section
 *   } finally {
 *     // Release the slot
 *     release();
 *   }
 */
export class Semaphore {
  private maxConcurrency: number;
  private currentCount = 0;
  private queue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    if (maxConcurrency < 1 || !Number.isInteger(maxConcurrency)) {
      throw new TypeError("Semaphore requires a positive integer maxConcurrency");
    }
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Acquire a slot. Resolves immediately if under the limit, otherwise waits FIFO.
   * Returns a `release()` function to call when done.
   */
  acquire(): Promise<Release> {
    return new Promise<Release>((resolve) => {
      const tryAcquire = () => {
        if (this.currentCount < this.maxConcurrency) {
          this.currentCount++;
          let released = false;
          const release: Release = () => {
            if (released) return;
            released = true;
            this.currentCount--;
            this.dispatch();
          };
          resolve(release);
        } else {
          this.queue.push(tryAcquire);
        }
      };

      tryAcquire();
    });
  }

  /**
   * Dispatch the next queued acquire() if possible.
   */
  private dispatch() {
    if (this.queue.length > 0 && this.currentCount < this.maxConcurrency) {
      const next = this.queue.shift()!;
      // Schedule next try in next tick to avoid deep recursion
      setImmediate(() => next());
    }
  }

  /**
   * Returns the number of currently active permits.
   */
  getActiveCount(): number {
    return this.currentCount;
  }

  /**
   * Returns the number of waiting acquirers.
   */
  getWaitingCount(): number {
    return this.queue.length;
  }
}
