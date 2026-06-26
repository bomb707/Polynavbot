const URL_CREDENTIAL_PATTERN = /:\/\/([^:@/]+):([^@/]+)@/g;

export function sanitizeErrorMessage(message: string): string {
  return message.replace(URL_CREDENTIAL_PATTERN, "://$1:[REDACTED]@");
}

export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  return sanitizeErrorMessage(String(error));
}
