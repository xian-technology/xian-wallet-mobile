/**
 * The failure text of a simulation that did not succeed, or null when it
 * succeeded or reports no status. The simulator answers a failing call with a
 * non-zero status and the failure as its result; sending that call anyway
 * executes, fails and pays its chi.
 */
export function simulationFailure(simulation: unknown): string | null {
  if (typeof simulation !== "object" || simulation === null) {
    return null;
  }
  const { status, result } = simulation as { status?: unknown; result?: unknown };
  if (typeof status !== "number" || status === 0) {
    return null;
  }
  return typeof result === "string" ? result : JSON.stringify(result ?? "unknown failure");
}

/** An estimate whose simulation fails: its chi (estimated and to supply) and the failure. */
export class SimulationFailedError extends Error {
  readonly estimated: number;
  readonly supply: number;

  constructor(
    estimate: { estimated: number; supply: number },
    readonly failure: string
  ) {
    super(`This transaction would fail: ${failure}`);
    this.name = "SimulationFailedError";
    this.estimated = estimate.estimated;
    this.supply = estimate.supply;
  }
}
