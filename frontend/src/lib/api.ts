export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string; details?: unknown };
  };
  if (!response.ok) {
    throw new ApiError(
      body.error?.message ?? "The request could not be completed",
      body.error?.code ?? "REQUEST_FAILED",
      response.status,
      body.error?.details,
    );
  }
  return body as T;
}
