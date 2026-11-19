"""
Workspace File Tree, Code Reader/Editor, Diff Generator, and Git Operations Manager.
"""

from __future__ import annotations

import difflib
import os
import subprocess
from typing import Any, Dict, List, Optional


IGNORED_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "dist",
    "build",
}


class WorkspaceGitManager:
    """Provides safe file tree traversal, code reading/editing, unified diffs, and Git CLI controls."""

    def __init__(self, workspace_dir: str) -> None:
        self.workspace_dir = os.path.abspath(workspace_dir)
        self._file_snapshots: Dict[str, str] = {}

    def _resolve_safe_path(self, rel_path: str) -> str:
        norm = os.path.normpath(os.path.join(self.workspace_dir, rel_path.lstrip("/")))
        if not norm.startswith(self.workspace_dir):
            raise ValueError("Path escapes the configured workspace directory.")
        return norm

    def list_file_tree(self) -> List[Dict[str, Any]]:
        """Returns a flat list of files and directories inside the workspace for fast mobile browsing."""
        items: List[Dict[str, Any]] = []
        git_modified = set(self._get_modified_paths())

        for root, dirs, files in os.walk(self.workspace_dir):
            dirs[:] = sorted([d for d in dirs if d not in IGNORED_DIRS])
            rel_root = os.path.relpath(root, self.workspace_dir)
            if rel_root == ".":
                rel_root = ""

            for f in sorted(files):
                if f.endswith(".pyc") or f == ".DS_Store":
                    continue
                rel_path = os.path.join(rel_root, f) if rel_root else f
                full_path = os.path.join(root, f)
                try:
                    size = os.path.getsize(full_path)
                except OSError:
                    size = 0
                items.append(
                    {
                        "path": rel_path,
                        "name": f,
                        "dir": rel_root,
                        "size": size,
                        "modified": rel_path in git_modified,
                    }
                )
        return items

    def read_file(self, rel_path: str) -> Dict[str, Any]:
        full_path = self._resolve_safe_path(rel_path)
        if not os.path.isfile(full_path):
            raise FileNotFoundError(f"File not found: {rel_path}")

        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        # Cache initial snapshot if not present
        self._file_snapshots.setdefault(rel_path, content)
        git_diff = self.get_file_diff(rel_path)
        return {
            "path": rel_path,
            "content": content,
            "diff": git_diff,
            "lines": len(content.splitlines()),
        }

    def write_file(self, rel_path: str, content: str) -> Dict[str, Any]:
        full_path = self._resolve_safe_path(rel_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        if os.path.isfile(full_path) and rel_path not in self._file_snapshots:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                self._file_snapshots[rel_path] = f.read()

        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)

        return {
            "path": rel_path,
            "saved": True,
            "diff": self.get_file_diff(rel_path),
        }

    def get_file_diff(self, rel_path: str) -> str:
        """Returns git diff for a file, or falls back to in-memory snapshot unified diff."""
        full_path = self._resolve_safe_path(rel_path)
        has_head = self._has_valid_head()
        if has_head:
            git_diff = self._run_git(["diff", "HEAD", "--", rel_path])
            if git_diff.strip() and "fatal:" not in git_diff:
                return git_diff

        # Check unstaged diff
        unstaged = self._run_git(["diff", "--", rel_path])
        if unstaged.strip() and "fatal:" not in unstaged:
            return unstaged

        # Fallback to snapshot comparison
        old = self._file_snapshots.get(rel_path)
        if old is not None and os.path.isfile(full_path):
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                current = f.read()
            if old != current:
                return "".join(
                    difflib.unified_diff(
                        old.splitlines(keepends=True),
                        current.splitlines(keepends=True),
                        fromfile=f"a/{rel_path}",
                        tofile=f"b/{rel_path}",
                    )
                )
        return ""

    def _has_valid_head(self) -> bool:
        try:
            res = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD"],
                cwd=self.workspace_dir,
                capture_output=True,
                text=True,
                timeout=4,
                check=False,
            )
            return res.returncode == 0
        except Exception:
            return False

    def _run_git(self, args: List[str]) -> str:
        try:
            res = subprocess.run(
                ["git"] + args,
                cwd=self.workspace_dir,
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            if res.returncode == 0:
                return res.stdout
            # Do not leak noisy git fatal messages when inside a container without .git
            err = res.stderr.strip()
            if "not a git repository" in err.lower() or "ambiguous argument 'head'" in err.lower():
                return ""
            return err
        except Exception as exc:
            return ""

    def _get_modified_paths(self) -> List[str]:
        if not os.path.isdir(os.path.join(self.workspace_dir, ".git")):
            return []
        out = self._run_git(["status", "--porcelain"])
        modified: List[str] = []
        for line in out.splitlines():
            if len(line) > 3:
                path_part = line[3:].strip().strip('"')
                if " -> " in path_part:
                    path_part = path_part.split(" -> ")[-1]
                modified.append(path_part)
        return modified

    def get_git_status(self) -> Dict[str, Any]:
        is_git_repo = os.path.isdir(os.path.join(self.workspace_dir, ".git"))
        if not is_git_repo:
            return {
                "is_git_repo": False,
                "branch": "no-git-repo (click a repo in GitHub Repos to clone)",
                "branches": ["main"],
                "files": [],
                "commits": [],
                "diff": "",
            }
        has_head = self._has_valid_head()
        branch = (
            self._run_git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
            if has_head
            else "main"
        ) or "main"
        porcelain = self._run_git(["status", "--porcelain"])
        files: List[Dict[str, str]] = []
        for line in porcelain.splitlines():
            if len(line) >= 3:
                status_code = line[:2].strip() or "M"
                filepath = line[3:].strip()
                files.append({"status": status_code, "path": filepath})

        branches_out = self._run_git(["branch", "--format=%(refname:short)"])
        branches = [b.strip() for b in branches_out.splitlines() if b.strip()] or [branch]

        commits: List[Dict[str, str]] = []
        if has_head:
            log_out = self._run_git(
                ["log", "-n", "8", "--pretty=format:%h|%an|%ar|%s"]
            )
            if "|" in log_out:
                for row in log_out.splitlines():
                    parts = row.split("|", 3)
                    if len(parts) == 4:
                        commits.append(
                            {
                                "hash": parts[0],
                                "author": parts[1],
                                "time": parts[2],
                                "message": parts[3],
                            }
                        )

        full_diff = self._run_git(["diff", "HEAD"]) if has_head else ""
        if not full_diff.strip():
            full_diff = self._run_git(["diff"])

        return {
            "is_git_repo": True,
            "branch": branch,
            "branches": branches,
            "files": files,
            "commits": commits,
            "diff": full_diff,
        }

    def git_stage_all(self) -> Dict[str, Any]:
        self._run_git(["add", "-A"])
        return self.get_git_status()

    def git_commit(self, message: str) -> Dict[str, Any]:
        if not message.strip():
            raise ValueError("Commit message cannot be empty.")
        self._run_git(["add", "-A"])
        out = self._run_git(["commit", "-m", message.strip()])
        status = self.get_git_status()
        status["last_output"] = out
        return status

    def git_checkout(self, branch_name: str, create: bool = False) -> Dict[str, Any]:
        clean = branch_name.strip()
        if not clean:
            raise ValueError("Branch name is required.")
        args = ["checkout", "-b", clean] if create else ["checkout", clean]
        out = self._run_git(args)
        status = self.get_git_status()
        status["last_output"] = out
        return status

    def create_checkpoint(self, label: str = "prompt-checkpoint") -> Dict[str, Any]:
        """Creates a non-destructive Git tree snapshot (using git stash create) so users can restore code anytime."""
        if not os.path.isdir(os.path.join(self.workspace_dir, ".git")):
            return {"created": False, "reason": "Not a git repository"}
        # Stage untracked files with intent-to-add or commit a lightweight snapshot ref
        self._run_git(["add", "-A"])
        tree_sha = self._run_git(["write-tree"]).strip()
        if not tree_sha or "fatal:" in tree_sha:
            return {"created": False, "reason": "Could not snapshot workspace tree"}
        # Unstage index changes so git status stays clean for the user
        if self._has_valid_head():
            self._run_git(["reset", "--quiet"])
        return {
            "created": True,
            "tree_sha": tree_sha,
            "label": label[:80],
            "workspace": os.path.basename(self.workspace_dir),
        }

    def restore_checkpoint(self, tree_sha: str) -> Dict[str, Any]:
        """Restores the workspace files back to the exact state captured in `tree_sha`."""
        clean_sha = tree_sha.strip()
        if not clean_sha or not all(c in "0123456789abcdef" for c in clean_sha.lower()):
            raise ValueError("Invalid checkpoint hash.")
        if not os.path.isdir(os.path.join(self.workspace_dir, ".git")):
            raise ValueError("Workspace is not a Git repository.")
        # Read the saved tree back into index and force-checkout files into working directory
        read_res = self._run_git(["read-tree", "--reset", "-u", clean_sha])
        if self._has_valid_head():
            self._run_git(["reset", "--quiet"])
        return {
            "restored": True,
            "tree_sha": clean_sha,
            "output": read_res,
            "git_status": self.get_git_status(),
        }

    def git_clone_repo(
        self,
        repo_url: str,
        folder_name: Optional[str] = None,
        token: Optional[str] = None,
    ) -> str:
        """Clones a remote Git repository (public or private with token) into a subfolder of the parent workspace."""
        clean_url = repo_url.strip()
        if not clean_url:
            raise ValueError("Repository URL is required.")
        parent_dir = os.path.dirname(self.workspace_dir)
        inferred = folder_name or os.path.basename(clean_url.rstrip("/")).replace(".git", "")
        safe_folder = "".join(c for c in inferred if c.isalnum() or c in ("-", "_", ".")) or "cloned-repo"
        target_dir = os.path.join(parent_dir, safe_folder)

        if os.path.isdir(target_dir) and os.path.isdir(os.path.join(target_dir, ".git")):
            return target_dir

        auth_url = clean_url
        gh_token = (token or os.environ.get("GITHUB_TOKEN", "")).strip()
        if gh_token and clean_url.startswith("https://github.com/"):
            auth_url = clean_url.replace("https://github.com/", f"https://x-access-token:{gh_token}@github.com/")

        res = subprocess.run(
            ["git", "clone", auth_url, target_dir],
            cwd=parent_dir,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if res.returncode != 0:
            # Scrub token from error message if clone failed
            err_text = res.stderr.strip()
            if gh_token:
                err_text = err_text.replace(gh_token, "***")
            raise ValueError(f"git clone failed: {err_text}")
        return target_dir

