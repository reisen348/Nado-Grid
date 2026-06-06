import type { GridPreview, StrategyRecord, StrategyStatusResponse } from "../../../../packages/shared/src/index.ts";

export interface CreateStrategyPayload {
  name?: string;
  currentPrice?: number;
  config: {
    market: string;
    productId?: number;
    direction: "long" | "short";
    lowerPrice: number;
    upperPrice: number;
    gridCount: number;
    marginPerGrid: number;
    leverage: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    postOnly: boolean;
    network: "mainnet" | "testnet";
  };
}

export async function login(password: string): Promise<void> {
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function me(): Promise<{ authenticated: boolean }> {
  return request("/api/auth/me");
}

export async function listStrategies(): Promise<StrategyRecord[]> {
  return request("/api/strategies");
}

export async function createStrategy(payload: CreateStrategyPayload): Promise<{ strategy: StrategyRecord; preview: GridPreview }> {
  return request("/api/strategies", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateStrategy(id: string, payload: CreateStrategyPayload): Promise<{ strategy: StrategyRecord; preview: GridPreview }> {
  return request(`/api/strategies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function getStatus(id: string): Promise<StrategyStatusResponse> {
  return request(`/api/strategies/${id}/status`);
}

export async function previewStrategy(id: string, currentPrice?: number): Promise<GridPreview> {
  return request(`/api/strategies/${id}/preview`, {
    method: "POST",
    body: JSON.stringify({ currentPrice })
  });
}

export async function syncStrategy(id: string, currentPrice?: number): Promise<StrategyStatusResponse> {
  return request(`/api/strategies/${id}/sync`, {
    method: "POST",
    body: JSON.stringify({ currentPrice })
  });
}

export async function startStrategy(
  id: string,
  executionMode: "dry-run" | "live",
  confirmPhrase?: string,
  currentPrice?: number
): Promise<{ strategy: StrategyRecord; preview: GridPreview }> {
  return request(`/api/strategies/${id}/start`, {
    method: "POST",
    body: JSON.stringify({ executionMode, confirmPhrase, currentPrice })
  });
}

export async function stopStrategy(id: string, emergency = false): Promise<StrategyRecord> {
  return request(`/api/strategies/${id}/stop`, {
    method: "POST",
    body: JSON.stringify({ closePosition: true, reason: emergency ? "emergency-stop" : "manual" })
  });
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    },
    ...init
  });
  const payload = (await response.json().catch(() => undefined)) as T | { error?: { message?: string } } | undefined;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error?.message
        : response.statusText;
    throw new Error(message || "Request failed");
  }
  return payload as T;
}
