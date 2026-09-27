"""CORS admits this project's Vercel URLs but not arbitrary *.vercel.app sites."""

import re

import pytest

from app.main import VERCEL_ORIGIN_REGEX


@pytest.mark.parametrize(
    "origin",
    [
        "https://cuenvia.vercel.app",
        "https://cuenvia-sosa-iqs-projects.vercel.app",
        "https://cuenvia-git-feat-prelaunch-hardening-sosa-iqs-projects.vercel.app",
        "https://cuenvia-bveq9wxuk-sosa-iqs-projects.vercel.app",
    ],
)
def test_project_vercel_origins_allowed(origin: str) -> None:
    assert re.fullmatch(VERCEL_ORIGIN_REGEX, origin)


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.vercel.app",
        "https://cuenvia-evil.vercel.app",
        "https://cuenvia.vercel.app.evil.com",
        "http://cuenvia.vercel.app",
    ],
)
def test_other_vercel_origins_rejected(origin: str) -> None:
    assert not re.fullmatch(VERCEL_ORIGIN_REGEX, origin)
