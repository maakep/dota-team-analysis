// Domain errors. Build-time prefetch surfaces these to the user with a clear
// message; UI shouldn't ever see them at runtime.

export class UserError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "UserError";
    this.exitCode = exitCode;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind: string;
  readonly body: unknown;
  readonly url: string;
  constructor(message: string, status: number, kind: string, body: unknown, url: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.body = body;
    this.url = url;
  }
}
