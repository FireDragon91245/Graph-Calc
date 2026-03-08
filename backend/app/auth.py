import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Dict, Optional

from app.persistence import _generate_id, get_jwt_secret

JWT_ALGORITHM = "HS256"
JWT_TTL_SECONDS = 60 * 60 * 24 * 7
PASSWORD_HASH_ITERATIONS = 200_000
DEFAULT_SESSION_VERSION = 1


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}")


def _load_secret() -> str:
    return get_jwt_secret(lambda: secrets.token_urlsafe(48))


def hash_password(password: str, salt: Optional[str] = None) -> Dict[str, Any]:
    salt_value = salt or secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_value.encode("utf-8"),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return {
        "passwordSalt": salt_value,
        "passwordHash": password_hash,
        "passwordIterations": PASSWORD_HASH_ITERATIONS,
    }


def verify_password(password: str, user: Dict[str, Any]) -> bool:
    salt = user.get("passwordSalt")
    if not salt:
        return False

    iterations = int(user.get("passwordIterations") or PASSWORD_HASH_ITERATIONS)
    candidate_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    ).hex()
    return hmac.compare_digest(candidate_hash, str(user.get("passwordHash", "")))


def create_user_record(username: str, password: str) -> Dict[str, Any]:
    password_data = hash_password(password)
    return {
        "id": _generate_id(),
        "username": username,
        "sessionVersion": DEFAULT_SESSION_VERSION,
        **password_data,
    }


def create_session_token(user: Dict[str, Any]) -> str:
    secret = _load_secret().encode("utf-8")
    now = int(time.time())
    payload = {
        "sub": user["id"],
        "userId": user["id"],
        "username": user["username"],
        "sessionVersion": int(user.get("sessionVersion") or DEFAULT_SESSION_VERSION),
        "iat": now,
        "exp": now + JWT_TTL_SECONDS,
    }
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}

    encoded_header = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(secret, signing_input, hashlib.sha256).digest()
    encoded_signature = _b64url_encode(signature)
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"


def decode_session_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError:
        return None

    secret = _load_secret().encode("utf-8")
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    expected_signature = _b64url_encode(hmac.new(secret, signing_input, hashlib.sha256).digest())

    if not hmac.compare_digest(encoded_signature, expected_signature):
        return None

    try:
        header = json.loads(_b64url_decode(encoded_header))
        payload = json.loads(_b64url_decode(encoded_payload))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return None

    if header.get("alg") != JWT_ALGORITHM:
        return None

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int) or expires_at <= int(time.time()):
        return None

    user_id = payload.get("userId") or payload.get("sub")
    username = payload.get("username")
    if not isinstance(user_id, str) or not isinstance(username, str):
        return None

    session_version = payload.get("sessionVersion")
    if not isinstance(session_version, int):
        session_version = DEFAULT_SESSION_VERSION

    return {
        "userId": user_id,
        "username": username,
        "exp": expires_at,
        "sessionVersion": session_version,
    }