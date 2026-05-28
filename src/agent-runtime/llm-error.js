export class LlmClientError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "LlmClientError";
    this.code = code;
    this.status = extra.status ?? null;
    this.detail = extra.detail ?? null;
  }
}
