"""Password encryption for résumé data, so it can live in a public repository.

Format (shared with the page's WebCrypto unlock): PBKDF2-HMAC-SHA256 -> AES-256-GCM,
base64 fields {v, iter, salt, iv, ct}, where ct includes the 16-byte GCM tag.

Usage:
    python3 scripts/vault.py seal   # private/resumes/ -> vault/resumes.enc.json (commit this file)
    python3 scripts/vault.py open   # vault/resumes.enc.json -> private/resumes/ (in a fresh checkout)

Password: $MIANSHI_PASSWORD, else private/.password, else prompted.
"""
import base64
import getpass
import hashlib
import io
import json
import os
import sys
import tarfile
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
RESUMES = ROOT / "private/resumes"
VAULT = ROOT / "vault/resumes.enc.json"
PASSWORD_FILE = ROOT / "private/.password"
ITERATIONS = 600_000

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode


def password(confirm=False):
    if os.environ.get("MIANSHI_PASSWORD"):
        return os.environ["MIANSHI_PASSWORD"]
    if PASSWORD_FILE.exists():
        return PASSWORD_FILE.read_text(encoding="utf-8").strip()
    value = getpass.getpass("简历数据密码：")
    if confirm and getpass.getpass("再输入一次：") != value:
        sys.exit("两次输入不一致")
    return value


def _key(secret, salt, iterations):
    return hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, iterations, 32)


def seal(data: bytes, secret: str) -> dict:
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(secret, salt, ITERATIONS)).encrypt(iv, data, None)
    return {"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def unseal(box: dict, secret: str) -> bytes:
    try:
        return AESGCM(_key(secret, unb64(box["salt"]), box["iter"])).decrypt(unb64(box["iv"]), unb64(box["ct"]), None)
    except InvalidTag:
        sys.exit("密码错误，或加密文件已损坏")


def seal_resumes(secret):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(RESUMES.rglob("*")):
            if path.is_file():
                tar.add(path, arcname=str(path.relative_to(RESUMES)))
    VAULT.parent.mkdir(exist_ok=True)
    VAULT.write_text(json.dumps(seal(buf.getvalue(), secret)), encoding="utf-8")
    print(f"{VAULT.relative_to(ROOT)}: sealed {len(list(RESUMES.glob('*/questions.json')))} résumé boards")


def open_resumes(secret):
    data = unseal(json.loads(VAULT.read_text(encoding="utf-8")), secret)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(RESUMES, filter="data")
    PASSWORD_FILE.write_text(secret, encoding="utf-8")
    print(f"restored {len(list(RESUMES.glob('*/questions.json')))} résumé boards into private/resumes/")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "seal":
        seal_resumes(password(confirm=True))
    elif command == "open":
        open_resumes(password())
    else:
        sys.exit(__doc__)
