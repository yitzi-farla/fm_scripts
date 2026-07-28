from __future__ import annotations

import hmac
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field, field_validator

APP_VERSION = "1.0.0"
RUNNER_ROOT = Path(os.getenv("RUNNER_ROOT", "/workspace/salad-gpu-runner")).resolve()
JOBS_ROOT = (RUNNER_ROOT / "jobs").resolve()
RUNNER_VENV = Path(os.getenv("RUNNER_VENV", "/opt/salad-runner-venv")).resolve()
RUNNER_API_KEY = os.getenv("RUNNER_API_KEY", "")
MAX_BUNDLE_BYTES = int(os.getenv("RUNNER_MAX_BUNDLE_BYTES", str(250 * 1024 * 1024)))
MAX_EXTRACTED_BYTES = int(os.getenv("RUNNER_MAX_EXTRACTED_BYTES", str(2 * 1024 * 1024 * 1024)))
MAX_FILES = int(os.getenv("RUNNER_MAX_FILES", "10000"))
DEFAULT_TIMEOUT_SECONDS = int(os.getenv("RUNNER_DEFAULT_TIMEOUT_SECONDS", "43200"))
MAX_TIMEOUT_SECONDS = int(os.getenv("RUNNER_MAX_TIMEOUT_SECONDS", "604800"))
DEFAULT_INHERITED_ENV_KEYS = [
    "CUDA_VISIBLE_DEVICES",
    "CUDA_HOME",
    "LD_LIBRARY_PATH",
    "NVIDIA_VISIBLE_DEVICES",
    "NVIDIA_DRIVER_CAPABILITIES",
    "STORAGEBOX_HOST",
    "STORAGEBOX_USER",
    "STORAGEBOX_PASSWORD",
    "STORAGEBOX_PORT",
]
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
JOB_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
PROTECTED_ENV_KEYS = {
    "RUNNER_API_KEY",
    "RUNNER_ROOT",
    "RUNNER_VENV",
    "RUNNER_PORT",
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LD_PRELOAD",
}

JOBS_ROOT.mkdir(parents=True, exist_ok=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def status_path(job_id: str) -> Path:
    return JOBS_ROOT / job_id / "status.json"


def load_status(job_id: str) -> dict[str, Any]:
    path = status_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    return read_json(path)


def save_status(job_id: str, **updates: Any) -> dict[str, Any]:
    path = status_path(job_id)
    current = read_json(path) if path.exists() else {"job_id": job_id, "created_at": utc_now()}
    current.update(updates)
    current["updated_at"] = utc_now()
    atomic_json(path, current)
    return current


def authenticate(x_runner_key: str | None = Header(default=None, alias="X-Runner-Key")) -> None:
    if not RUNNER_API_KEY:
        raise HTTPException(status_code=503, detail="RUNNER_API_KEY is not configured")
    if not x_runner_key or not hmac.compare_digest(x_runner_key, RUNNER_API_KEY):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid runner key")


class JobManifest(BaseModel):
    command: list[str] = Field(min_length=1, max_length=128)
    env: dict[str, str] = Field(default_factory=dict)
    requirements: str | None = "requirements.txt"
    workdir: str = "."
    output_dir: str = "outputs"
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    create_venv: bool = True
    system_site_packages: bool = True

    @field_validator("command")
    @classmethod
    def validate_command(cls, value: list[str]) -> list[str]:
        if any(not isinstance(item, str) or not item or "\x00" in item for item in value):
            raise ValueError("command must contain non-empty strings without NUL bytes")
        return value

    @field_validator("env")
    @classmethod
    def validate_env(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 200:
            raise ValueError("env contains too many keys")
        for key, item in value.items():
            if not ENV_NAME_RE.fullmatch(key):
                raise ValueError(f"invalid environment variable name: {key}")
            if key in PROTECTED_ENV_KEYS or key.startswith("RUNNER_"):
                raise ValueError(f"environment variable cannot be overridden: {key}")
            if not isinstance(item, str):
                raise ValueError(f"environment value must be a string: {key}")
            if len(item.encode("utf-8")) > 65536:
                raise ValueError(f"environment value is too large: {key}")
        return value

    @field_validator("requirements", "workdir", "output_dir")
    @classmethod
    def validate_relative_path(cls, value: str | None) -> str | None:
        if value is None:
            return value
        candidate = Path(value)
        if candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("paths must be relative and may not contain '..'")
        return value

    @field_validator("timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: int) -> int:
        if value < 1 or value > MAX_TIMEOUT_SECONDS:
            raise ValueError(f"timeout_seconds must be between 1 and {MAX_TIMEOUT_SECONDS}")
        return value


class JobResponse(BaseModel):
    job_id: str
    status: str
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    exit_code: int | None = None
    error: str | None = None
    env_keys: list[str] = Field(default_factory=list)
    command: list[str] = Field(default_factory=list)


class QueueItem(BaseModel):
    job_id: str
    manifest: JobManifest


class RuntimeJob:
    def __init__(self) -> None:
        self.process: subprocess.Popen[str] | None = None
        self.cancel_requested = False


job_queue: queue.Queue[QueueItem] = queue.Queue()
runtime_jobs: dict[str, RuntimeJob] = {}
runtime_lock = threading.Lock()


def require_job_id(job_id: str) -> str:
    if not JOB_ID_RE.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    return job_id


def safe_child(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path escapes job directory")
    return candidate


def safe_extract(archive: Path, destination: Path) -> None:
    total_size = 0
    file_count = 0
    with zipfile.ZipFile(archive) as handle:
        for member in handle.infolist():
            file_count += 1
            if file_count > MAX_FILES:
                raise ValueError(f"Archive contains more than {MAX_FILES} entries")
            total_size += member.file_size
            if total_size > MAX_EXTRACTED_BYTES:
                raise ValueError("Extracted archive would exceed the configured size limit")
            mode = (member.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise ValueError("Symbolic links are not allowed in uploaded archives")
            target = safe_child(destination, member.filename)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with handle.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)


def inherited_environment() -> dict[str, str]:
    keys = list(DEFAULT_INHERITED_ENV_KEYS)
    extra = os.getenv("RUNNER_INHERIT_ENV_KEYS", "")
    keys.extend(part.strip() for part in extra.split(",") if part.strip())
    result: dict[str, str] = {}
    for key in keys:
        if key in os.environ and key not in PROTECTED_ENV_KEYS and not key.startswith("RUNNER_"):
            result[key] = os.environ[key]
    return result


def build_process_environment(manifest: JobManifest, job_dir: Path, source_dir: Path, output_dir: Path) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
        "HOME": str(job_dir),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        "PYTHONUNBUFFERED": "1",
        "JOB_ID": job_dir.name,
        "JOB_DIR": str(job_dir),
        "SOURCE_DIR": str(source_dir),
        "OUTPUT_DIR": str(output_dir),
    }
    for key in ("LD_LIBRARY_PATH", "CUDA_HOME", "CUDA_VISIBLE_DEVICES", "NVIDIA_VISIBLE_DEVICES", "NVIDIA_DRIVER_CAPABILITIES"):
        if key in os.environ:
            env[key] = os.environ[key]
    env.update(inherited_environment())
    env.update(manifest.env)
    return env


def venv_paths(job_dir: Path) -> tuple[Path, Path]:
    venv_dir = job_dir / ".venv"
    return venv_dir / "bin" / "python", venv_dir / "bin" / "pip"


def prepare_runtime(item: QueueItem, job_dir: Path, source_dir: Path, log_handle: Any) -> tuple[list[str], dict[str, str], Path]:
    manifest = item.manifest
    workdir = safe_child(source_dir, manifest.workdir)
    if not workdir.exists() or not workdir.is_dir():
        raise FileNotFoundError(f"workdir does not exist: {manifest.workdir}")
    output_dir = safe_child(job_dir, manifest.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    env = build_process_environment(manifest, job_dir, source_dir, output_dir)
    command = list(manifest.command)

    if manifest.create_venv:
        python_path, pip_path = venv_paths(job_dir)
        if not python_path.exists():
            uv = RUNNER_VENV / "bin" / "uv"
            venv_command = [str(uv), "venv", str(job_dir / ".venv")]
            if manifest.system_site_packages:
                venv_command.append("--system-site-packages")
            subprocess.run(venv_command, cwd=workdir, env=env, stdout=log_handle, stderr=subprocess.STDOUT, text=True, check=True)
        requirements = safe_child(source_dir, manifest.requirements) if manifest.requirements else None
        if requirements and requirements.exists():
            uv = RUNNER_VENV / "bin" / "uv"
            subprocess.run(
                [str(uv), "pip", "install", "--python", str(python_path), "-r", str(requirements)],
                cwd=workdir,
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
                check=True,
            )
        if command[0] in {"python", "python3"}:
            command[0] = str(python_path)
        elif command[0] in {"pip", "pip3"}:
            command[0] = str(pip_path)
        env["VIRTUAL_ENV"] = str(job_dir / ".venv")
        env["PATH"] = f"{job_dir / '.venv' / 'bin'}:{env['PATH']}"

    return command, env, workdir


def terminate_process(process: subprocess.Popen[str], grace_seconds: int = 15) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.time() + grace_seconds
    while time.time() < deadline:
        if process.poll() is not None:
            return
        time.sleep(0.25)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_job(item: QueueItem) -> None:
    job_id = item.job_id
    job_dir = JOBS_ROOT / job_id
    source_dir = job_dir / "source"
    log_path = job_dir / "stdout.log"
    runtime = RuntimeJob()
    with runtime_lock:
        runtime_jobs[job_id] = runtime

    save_status(job_id, status="running", started_at=utc_now())
    exit_code: int | None = None
    error: str | None = None
    timed_out = False
    try:
        with log_path.open("a", encoding="utf-8", buffering=1) as log_handle:
            command, env, workdir = prepare_runtime(item, job_dir, source_dir, log_handle)
            save_status(job_id, command=command)
            process = subprocess.Popen(
                command,
                cwd=workdir,
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
            )
            runtime.process = process
            try:
                exit_code = process.wait(timeout=item.manifest.timeout_seconds)
            except subprocess.TimeoutExpired:
                timed_out = True
                terminate_process(process)
                exit_code = process.wait()
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    finally:
        with runtime_lock:
            runtime_jobs.pop(job_id, None)

    if runtime.cancel_requested:
        final_status = "cancelled"
    elif timed_out:
        final_status = "timed_out"
        error = error or f"Job exceeded timeout of {item.manifest.timeout_seconds} seconds"
    elif error is not None:
        final_status = "failed"
    elif exit_code == 0:
        final_status = "succeeded"
    else:
        final_status = "failed"
        error = error or f"Process exited with code {exit_code}"
    save_status(job_id, status=final_status, finished_at=utc_now(), exit_code=exit_code, error=error)


def worker_loop() -> None:
    while True:
        item = job_queue.get()
        try:
            run_job(item)
        finally:
            job_queue.task_done()


def recover_interrupted_jobs() -> None:
    for path in JOBS_ROOT.glob("*/status.json"):
        try:
            current = read_json(path)
        except Exception:
            continue
        if current.get("status") in {"queued", "running"}:
            current.update({"status": "interrupted", "finished_at": utc_now(), "updated_at": utc_now(), "error": "Runner restarted before job completion"})
            atomic_json(path, current)


recover_interrupted_jobs()
threading.Thread(target=worker_loop, name="salad-job-worker", daemon=True).start()

app = FastAPI(
    title="Salad Generic GPU Runner",
    version=APP_VERSION,
    description="Authenticated single-GPU job runner. Upload a ZIP, command array, and per-job environment variables.",
)


@app.get("/health")
def health() -> dict[str, Any]:
    active = None
    with runtime_lock:
        if runtime_jobs:
            active = next(iter(runtime_jobs))
    return {
        "ok": True,
        "version": APP_VERSION,
        "queue_depth": job_queue.qsize(),
        "active_job": active,
        "cuda_visible_devices": os.getenv("CUDA_VISIBLE_DEVICES"),
    }


@app.post("/jobs", response_model=JobResponse, dependencies=[Depends(authenticate)], status_code=202)
async def create_job(
    bundle: UploadFile = File(..., description="ZIP archive containing the Python project"),
    manifest: str = Form(..., description="JSON object with command, env, requirements, workdir and timeout_seconds"),
    requested_job_id: str | None = Form(default=None),
) -> JobResponse:
    try:
        parsed = JobManifest.model_validate_json(manifest)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid manifest: {exc}") from exc

    if requested_job_id:
        job_id = requested_job_id.lower()
        if not JOB_ID_RE.fullmatch(job_id):
            raise HTTPException(status_code=422, detail="requested_job_id must match ^[a-z0-9][a-z0-9-]{0,62}$")
    else:
        job_id = uuid.uuid4().hex[:16]

    job_dir = JOBS_ROOT / job_id
    try:
        job_dir.mkdir(parents=False, exist_ok=False)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="Job id already exists") from exc

    source_dir = job_dir / "source"
    source_dir.mkdir()
    archive_path = job_dir / "bundle.zip"
    total = 0
    try:
        with archive_path.open("wb") as output:
            while chunk := await bundle.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BUNDLE_BYTES:
                    raise HTTPException(status_code=413, detail="Uploaded bundle exceeds the configured limit")
                output.write(chunk)
        if not zipfile.is_zipfile(archive_path):
            raise HTTPException(status_code=422, detail="bundle must be a valid ZIP archive")
        safe_extract(archive_path, source_dir)
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    finally:
        await bundle.close()

    redacted_manifest = parsed.model_dump()
    redacted_manifest["env"] = {key: "***" for key in parsed.env}
    atomic_json(job_dir / "manifest.redacted.json", redacted_manifest)
    created = save_status(
        job_id,
        status="queued",
        command=parsed.command,
        env_keys=sorted(parsed.env),
        bundle_filename=bundle.filename,
        bundle_bytes=total,
    )
    job_queue.put(QueueItem(job_id=job_id, manifest=parsed))
    return JobResponse(**created)


@app.get("/jobs", response_model=list[JobResponse], dependencies=[Depends(authenticate)])
def list_jobs(limit: int = Query(default=100, ge=1, le=1000)) -> list[JobResponse]:
    jobs: list[dict[str, Any]] = []
    for path in JOBS_ROOT.glob("*/status.json"):
        try:
            jobs.append(read_json(path))
        except Exception:
            continue
    jobs.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return [JobResponse(**item) for item in jobs[:limit]]


@app.get("/jobs/{job_id}", response_model=JobResponse, dependencies=[Depends(authenticate)])
def get_job(job_id: str) -> JobResponse:
    require_job_id(job_id)
    return JobResponse(**load_status(job_id))


@app.get("/jobs/{job_id}/logs", response_class=PlainTextResponse, dependencies=[Depends(authenticate)])
def get_logs(job_id: str, tail_bytes: int = Query(default=200000, ge=1, le=5_000_000)) -> str:
    require_job_id(job_id)
    load_status(job_id)
    path = JOBS_ROOT / job_id / "stdout.log"
    if not path.exists():
        return ""
    with path.open("rb") as handle:
        size = path.stat().st_size
        handle.seek(max(0, size - tail_bytes))
        return handle.read().decode("utf-8", errors="replace")


@app.post("/jobs/{job_id}/cancel", response_model=JobResponse, dependencies=[Depends(authenticate)])
def cancel_job(job_id: str) -> JobResponse:
    require_job_id(job_id)
    current = load_status(job_id)
    if current.get("status") not in {"queued", "running"}:
        return JobResponse(**current)
    with runtime_lock:
        runtime = runtime_jobs.get(job_id)
        if runtime:
            runtime.cancel_requested = True
            if runtime.process:
                terminate_process(runtime.process)
            current = save_status(job_id, status="cancelling")
        else:
            current = save_status(job_id, status="cancel_requested")
    return JobResponse(**current)


@app.get("/jobs/{job_id}/artifacts", dependencies=[Depends(authenticate)])
def download_artifacts(job_id: str) -> FileResponse:
    require_job_id(job_id)
    load_status(job_id)
    job_dir = JOBS_ROOT / job_id
    archive = job_dir / "artifacts.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as handle:
        for relative in ("outputs", "stdout.log", "status.json", "manifest.redacted.json"):
            path = job_dir / relative
            if path.is_file():
                handle.write(path, arcname=relative)
            elif path.is_dir():
                for child in path.rglob("*"):
                    if child.is_file():
                        handle.write(child, arcname=str(child.relative_to(job_dir)))
    return FileResponse(archive, media_type="application/zip", filename=f"{job_id}-artifacts.zip")
