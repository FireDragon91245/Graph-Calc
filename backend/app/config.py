import json
from functools import lru_cache
from pathlib import Path
from typing import List, Literal

from pydantic import BaseModel


class SslConfig(BaseModel):
    certFile: str
    keyFile: str


class ServerConfig(BaseModel):
    host: str
    port: int
    frontendOrigins: List[str]
    logRequests: bool = True
    ssl: SslConfig


class CookieConfig(BaseModel):
    name: str
    httpOnly: bool = True
    secure: bool = True
    sameSite: Literal["lax", "strict", "none"] = "lax"
    path: str = "/"


class AuthConfig(BaseModel):
    jwtAlgorithm: str
    jwtTtlSeconds: int
    passwordHashIterations: int
    defaultSessionVersion: int
    cookie: CookieConfig


class MongoConfig(BaseModel):
    host: str
    port: int
    username: str = ""
    password: str = ""
    authDatabase: str
    database: str
    allowNoAuthFallback: bool = True


class AppConfig(BaseModel):
    server: ServerConfig
    auth: AuthConfig
    mongo: MongoConfig


CONFIG_FILE = Path(__file__).resolve().parent.parent / "config.json"


def resolve_backend_path(relative_path: str) -> Path:
    return (CONFIG_FILE.parent / relative_path).resolve()


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    with open(CONFIG_FILE, "r", encoding="utf-8") as file_handle:
        payload = json.load(file_handle)
    return AppConfig.model_validate(payload)
