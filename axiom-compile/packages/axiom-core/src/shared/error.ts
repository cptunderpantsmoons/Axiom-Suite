/** Core error types. Axiom is fail-closed: we never emit a half-valid packet. */

export class AxiomError extends Error {}

/** A model output that could not be validated even after repair retries. */
export class FailClosedError extends AxiomError {
  constructor(message: string) {
    super(`Fail-closed: ${message}`);
    this.name = "FailClosedError";
  }
}

/** More than `maxRepairRetries` invalid model responses. */
export class RepairLimitExceeded extends AxiomError {
  constructor() {
    super("Model output failed validation after the maximum repair retries.");
    this.name = "RepairLimitExceeded";
  }
}

/** Missing/invalid configuration (e.g. no API key for a real provider). */
export class ConfigError extends AxiomError {
  constructor(message: string) {
    super(`Config error: ${message}`);
    this.name = "ConfigError";
  }
}