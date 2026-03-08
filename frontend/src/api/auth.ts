import { apiFetch, getErrorMessage } from "./client";

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

async function submitCredentials(path: string, username: string, password: string): Promise<AuthResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Authentication failed"));
  }

  return response.json() as Promise<AuthResponse>;
}

export function registerUser(username: string, password: string): Promise<AuthResponse> {
  return submitCredentials("/register", username, password);
}

export function authenticateUser(username: string, password: string): Promise<AuthResponse> {
  return submitCredentials("/authenticate", username, password);
}

export async function getSession(): Promise<SessionResponse> {
  const response = await apiFetch("/session");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load session"));
  }
  return response.json() as Promise<SessionResponse>;
}

export async function logoutUser(): Promise<void> {
  const response = await apiFetch("/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to log out"));
  }
}