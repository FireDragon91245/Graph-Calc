import { apiFetch, getErrorMessage } from "./client";

export interface AuthUser {
  id: string;
  username: string;
  projectCount: number;
  activeProjectId: string | null;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
  };
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

export async function getMe(): Promise<AuthUser> {
  const response = await apiFetch("/me");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load account"));
  }
  return response.json() as Promise<AuthUser>;
}

export async function getWhoAmI(): Promise<AuthUser> {
  const response = await apiFetch("/whoami");
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load account"));
  }
  return response.json() as Promise<AuthUser>;
}

export async function getSession(): Promise<SessionResponse> {
  const response = await apiFetch("/session");
  if (response.status === 401) {
    return { authenticated: false, user: null };
  }
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to load session"));
  }
  return response.json() as Promise<SessionResponse>;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const response = await apiFetch("/me/password", {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to change password"));
  }
  const data = await response.json() as { user: AuthUser };
  return data.user;
}

export async function deleteAccount(currentPassword: string): Promise<void> {
  const response = await apiFetch("/me", {
    method: "DELETE",
    body: JSON.stringify({ currentPassword })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to delete account"));
  }
}

export async function logoutUser(): Promise<void> {
  const response = await apiFetch("/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Failed to log out"));
  }
}