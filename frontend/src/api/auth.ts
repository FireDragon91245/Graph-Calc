import { apiFetch, getErrorMessage } from "./client";

export interface AuthUser {
  id: string;
  username: string;
  projectCount: number;
  activeProjectId: string | null;
  profileImageId: string | null;
  settings: AccountSettings;
}

export interface AccountSettings {
  language: string | null;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
  };
}

async function submitCredentials(path: string, username: string, password: string): Promise<AuthResponse> {
  const response = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "errors.authenticationFailed"));
  }

  return response.json() as Promise<AuthResponse>;
}

export function registerUser(username: string, password: string): Promise<AuthResponse> {
  return submitCredentials("/user/register", username, password);
}

export function authenticateUser(username: string, password: string): Promise<AuthResponse> {
  return submitCredentials("/user/auth", username, password);
}

export async function getMe(): Promise<AuthUser> {
  const response = await apiFetch("/user/info");
  if (response.status === 401) {
    throw new Error("errors.unauthorized");
  }
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "errors.loadAccount"));
  }
  return response.json() as Promise<AuthUser>;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const response = await apiFetch("/user/password", {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "errors.changePassword"));
  }
  const data = await response.json() as { user: AuthUser };
  return data.user;
}

export async function deleteAccount(currentPassword: string): Promise<void> {
  const response = await apiFetch("/user/delete", {
    method: "DELETE",
    body: JSON.stringify({ currentPassword })
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "errors.deleteAccount"));
  }
}

export async function logoutUser(): Promise<void> {
  const response = await apiFetch("/user/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "errors.logout"));
  }
}

export async function updateAccountSettings(settings: Partial<AccountSettings>): Promise<AccountSettings> {
  const response = await apiFetch("/user/settings", {
    method: "PATCH",
    body: JSON.stringify(settings)
  });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "settings.general.saveFailed"));
  }
  return response.json() as Promise<AccountSettings>;
}

export async function getProfileImage(): Promise<Blob | null> {
  const response = await apiFetch("/user/profile-image");
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "settings.account.image.loadFailed"));
  }
  return response.blob();
}

export async function uploadProfileImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const response = await apiFetch("/user/profile-image", { method: "PUT", body: form });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "settings.account.image.uploadFailed"));
  }
  const data = await response.json() as { profileImageId: string };
  return data.profileImageId;
}

export async function removeProfileImage(): Promise<void> {
  const response = await apiFetch("/user/profile-image", { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "settings.account.image.removeFailed"));
  }
}
