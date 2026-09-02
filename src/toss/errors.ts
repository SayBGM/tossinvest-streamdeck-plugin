export type TossErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "IP_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "INVALID_SYMBOL"
  | "NETWORK"
  | "API";

export class TossError extends Error {
  constructor(
    readonly code: TossErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "TossError";
  }
}

export function safeMessageForError(error: unknown): string {
  if (!(error instanceof TossError)) return "토스증권 API 연결을 확인해 주세요.";
  switch (error.code) {
    case "AUTH_REQUIRED": return "API 인증정보를 입력해 주세요.";
    case "INVALID_CREDENTIALS": return "Client ID 또는 Secret을 확인해 주세요.";
    case "IP_NOT_ALLOWED": return "WTS에서 현재 IP를 허용해 주세요.";
    case "RATE_LIMITED": return "요청이 많아 잠시 후 다시 시도합니다.";
    case "INVALID_SYMBOL": return "종목 코드를 확인해 주세요.";
    case "NETWORK": return "네트워크 연결을 확인해 주세요.";
    default: return "토스증권 API 응답을 확인해 주세요.";
  }
}
