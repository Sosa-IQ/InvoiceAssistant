"""Quality-gate coverage for the GitHub Actions workflow.

CI is the only place the full backend/frontend/SQL matrix runs, so the workflow
definition itself is treated as testable configuration: if a gate silently
disappears, these tests fail instead of the regression reaching main.
"""

import re
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[2]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW_PATH.read_text())


def _job(name: str) -> dict:
    jobs = _workflow()["jobs"]
    assert name in jobs, f"CI workflow is missing the {name!r} job."
    return jobs[name]


def _run_commands(job: dict) -> str:
    return "\n".join(step.get("run", "") for step in job["steps"])


def test_workflow_runs_on_push_and_pull_request() -> None:
    workflow = _workflow()

    # PyYAML parses a bare `on:` key as the boolean True.
    triggers = workflow.get("on", workflow.get(True))

    assert set(triggers) >= {"push", "pull_request"}


def test_backend_job_compiles_tests_and_audits_dependencies() -> None:
    commands = _run_commands(_job("backend"))

    assert "compileall" in commands
    assert "pytest" in commands
    assert "pip-audit" in commands


def test_backend_job_runs_against_a_postgres_service_with_pgvector() -> None:
    job = _job("backend")

    services = job.get("services", {})
    assert "postgres" in services, "Backend job needs a PostgreSQL service for isolation tests."
    assert "pgvector" in services["postgres"]["image"], "PostgreSQL service must provide pgvector."


def test_backend_job_enables_the_database_backed_suites() -> None:
    """Without TEST_DATABASE_URL the migration and isolation suites silently skip."""
    env = _job("backend")["env"]

    assert "TEST_DATABASE_URL" in env
    # The safety guard rejects a test database that is also the app database,
    # so CI must not point both at the same place.
    assert env["TEST_DATABASE_URL"] != env["DATABASE_URL"]


def test_frontend_job_installs_builds_lints_and_audits() -> None:
    commands = _run_commands(_job("frontend"))

    assert "npm ci" in commands
    assert "npm run build" in commands
    assert "npm run lint" in commands
    # Production dependencies are audited at a stricter level than dev tooling.
    assert "npm audit --omit=dev --audit-level=moderate" in commands
    assert "npm audit --audit-level=high" in commands


def test_sql_job_applies_schema_against_a_real_database() -> None:
    job = _job("sql")

    assert "postgres" in job.get("services", {}), "SQL validation must run against a real database."
    commands = _run_commands(job)
    assert "setup_invoice_assistant_core.sql" in commands
    assert "add_per_client_invoice_numbering.sql" in commands


def test_workflow_uses_synthetic_config_and_never_reads_repository_secrets() -> None:
    raw = WORKFLOW_PATH.read_text()

    assert "secrets." not in raw, "CI quality gates must not consume repository secrets."
    assert "supabase.co" not in raw, "CI must not reference a real Supabase project host."
    assert not re.search(r"sk-[A-Za-z0-9]{8,}", raw), "CI must not embed an OpenAI-style key."


@pytest.mark.parametrize("package", ["pytest", "pytest-asyncio", "pip-audit"])
def test_dev_requirements_pin_the_tools_ci_invokes(package: str) -> None:
    """A tool CI runs but does not install would fail the run on a clean checkout."""
    requirements = (REPO_ROOT / "backend" / "requirements-dev.txt").read_text().lower()

    assert re.search(rf"^{re.escape(package)}==", requirements, re.MULTILINE), (
        f"{package} must be pinned in requirements-dev.txt."
    )
