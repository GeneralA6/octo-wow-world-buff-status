/**
 * Marks an error the supervisor should NOT retry — wrong credentials, a banned
 * account, a missing character. Transient errors (network drops) are plain
 * Errors and get retried with backoff.
 */
export class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalError";
  }
}
