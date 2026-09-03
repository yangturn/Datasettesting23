from __future__ import annotations

import hashlib
import json
import shutil
import stat
import subprocess
import sys
import time
from argparse import ArgumentParser, ArgumentTypeError
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZipInfo


REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = REPO_ROOT / "datasets" / "behaviorchain.zip"
DATASET_DIR = REPO_ROOT / "datasets" / "behaviorchain"
CHECKSUM_FILE = DATASET_DIR / ".archive-sha256"
EVENT_PREFIX = "@@BEHAVIORCHAIN@@"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def member_path(info: ZipInfo) -> PurePosixPath:
    # ZIP paths use forward slashes. Normalizing backslashes as well keeps the
    # safety check consistent on Windows-created or unusually encoded archives.
    path = PurePosixPath(info.filename.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe path in BehaviorChain archive: {info.filename}")
    if path.parts and ":" in path.parts[0]:
        raise ValueError(f"Unsafe path in BehaviorChain archive: {info.filename}")
    return path


def is_symlink(info: ZipInfo) -> bool:
    unix_mode = info.external_attr >> 16
    return stat.S_IFMT(unix_mode) == stat.S_IFLNK


def should_skip(path: PurePosixPath) -> bool:
    return "__MACOSX" in path.parts or path.name == ".DS_Store"


def extract(*, quiet: bool = False) -> None:
    if not ARCHIVE.is_file():
        raise FileNotFoundError(f"BehaviorChain archive not found: {ARCHIVE}")

    archive_checksum = sha256(ARCHIVE)
    if CHECKSUM_FILE.is_file():
        recorded_checksum = CHECKSUM_FILE.read_text(encoding="utf-8").strip()
        if recorded_checksum == archive_checksum:
            if not quiet:
                print(f"BehaviorChain is already extracted at {DATASET_DIR}")
            return

    if DATASET_DIR.exists():
        raise FileExistsError(
            "Extraction target already exists but does not match the current "
            f"archive: {DATASET_DIR}\nMove it aside and run this script again."
        )

    with ZipFile(ARCHIVE) as archive:
        members: list[tuple[ZipInfo, PurePosixPath]] = []
        for info in archive.infolist():
            path = member_path(info)
            if is_symlink(info):
                raise ValueError(
                    f"BehaviorChain archive contains a symbolic link: {info.filename}"
                )
            if not should_skip(path):
                members.append((info, path))

        for info, path in members:
            destination = REPO_ROOT / "datasets" / Path(*path.parts)
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue

            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)

    if not DATASET_DIR.is_dir():
        raise RuntimeError(
            f"Archive did not produce the expected directory: {DATASET_DIR}"
        )

    CHECKSUM_FILE.write_text(f"{archive_checksum}\n", encoding="utf-8")
    if not quiet:
        print(f"Extracted BehaviorChain to {DATASET_DIR}")


def positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise ArgumentTypeError("must be a positive integer") from error
    if parsed < 1:
        raise ArgumentTypeError("must be a positive integer")
    return parsed


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return "--:--"
    seconds = max(0, round(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return (
        f"{hours:d}:{minutes:02d}:{seconds:02d}"
        if hours
        else f"{minutes:02d}:{seconds:02d}"
    )


class ProgressBar:
    """Dependency-free tqdm-style progress for the cross-platform runner."""

    def __init__(self, label: str, total: int) -> None:
        self.label = label
        self.total = total
        self.done = 0
        self.generated = 0
        self.started_at = time.monotonic()
        self.last_rendered_at = 0.0
        self.interactive = sys.stderr.isatty()
        self.render(force=True)

    def update(self, units: int, *, cached: bool) -> None:
        self.done = min(self.total, self.done + units)
        if not cached:
            self.generated += units
        self.render()

    def render(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_rendered_at < 0.1:
            return
        self.last_rendered_at = now

        elapsed = now - self.started_at
        rate = self.generated / elapsed if elapsed > 0 else 0.0
        remaining = max(0, self.total - self.done)
        eta = remaining / rate if rate > 0 else None
        fraction = self.done / self.total if self.total else 1.0

        terminal_width = shutil.get_terminal_size(fallback=(100, 24)).columns
        stats = (
            f" {self.done}/{self.total} "
            f"[{format_duration(elapsed)}<{format_duration(eta)}, "
            f"{rate:.2f} steps/s]"
        )
        fixed_width = len(self.label) + len(f"{fraction:6.1%}") + len(stats) + 5
        bar_width = max(10, min(36, terminal_width - fixed_width))
        filled = min(bar_width, int(fraction * bar_width))
        bar = "█" * filled + "░" * (bar_width - filled)
        line = f"{self.label}: {fraction:6.1%}|{bar}|{stats}"
        if self.interactive:
            sys.stderr.write(f"\r\033[2K{line}")
            sys.stderr.flush()

    def close(self) -> None:
        self.render(force=True)
        if self.interactive:
            sys.stderr.write("\n")
            sys.stderr.flush()


def run_worker(
    *,
    sample: int | None,
    concurrency: int | None,
    flow_set: str | None = None,
) -> None:
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node.js is required to run the BehaviorChain evaluation.")

    if not (REPO_ROOT / "node_modules" / "tsx").is_dir():
        raise RuntimeError("Dependencies are missing. Run `npm install` first.")

    worker = REPO_ROOT / "scripts" / "behaviorchain_runner.ts"
    command = [
        node,
        "--conditions=react-server",
        "--import",
        "tsx",
        str(worker),
    ]
    if sample is not None:
        command.extend(["--sample", str(sample)])
    if concurrency is not None:
        command.extend(["--concurrency", str(concurrency)])
    if flow_set is not None:
        command.extend(["--flow-set", flow_set])

    process = subprocess.Popen(
        command,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None

    progress: ProgressBar | None = None
    diagnostics: list[str] = []
    completion: dict[str, object] | None = None
    try:
        for raw_line in process.stdout:
            line = raw_line.rstrip("\r\n")
            if not line.startswith(EVENT_PREFIX):
                if line:
                    diagnostics.append(line)
                continue

            event = json.loads(line[len(EVENT_PREFIX) :])
            event_type = event.get("type")
            if event_type == "start":
                progress = ProgressBar(
                    str(event["label"]),
                    int(event["total_units"]),
                )
            elif event_type == "progress" and progress is not None:
                progress.update(
                    int(event.get("units", 1)),
                    cached=bool(event.get("cached", False)),
                )
            elif event_type == "complete":
                completion = event
            elif event_type == "retry":
                # Retried calls remain represented by the rate and ETA; keeping
                # this off-screen prevents transient network noise from
                # destroying the single progress display.
                continue
    except KeyboardInterrupt:
        process.terminate()
        raise
    finally:
        return_code = process.wait()
        if progress is not None:
            progress.close()

    if return_code != 0:
        if diagnostics:
            print("\n".join(diagnostics), file=sys.stderr)
        sys.exit(return_code)

    if completion is None:
        raise RuntimeError("BehaviorChain worker exited without a final report.")

    print(json.dumps(completion["overall"], indent=2))
    print(f"Report: {completion['report']}")


def main() -> None:
    parser = ArgumentParser(
        description=(
            "Extract BehaviorChain when necessary, then run the memory-ablated "
            "multiple-choice evaluation."
        )
    )
    parser.add_argument(
        "--sample",
        type=positive_int,
        metavar="N",
        help=(
            "sample N character files with the fixed seed 42; omit to run all "
            "characters"
        ),
    )
    parser.add_argument(
        "--concurrency",
        type=positive_int,
        metavar="N",
        help="maximum concurrent OpenRouter requests (default: 24)",
    )
    args = parser.parse_args()

    extract(quiet=True)
    run_worker(sample=args.sample, concurrency=args.concurrency)


if __name__ == "__main__":
    main()
