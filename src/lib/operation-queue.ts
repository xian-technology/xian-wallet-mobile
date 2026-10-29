/** Serialize operations while allowing the next operation after a rejection. */
export class OperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }

  settled(): Promise<void> {
    return this.tail;
  }
}
