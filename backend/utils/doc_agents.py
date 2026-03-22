"""
Specialized documentation agents.
Each produces ONE document for a new software project idea.
"""

from agents.base import BaseAgent
from agents.project_overview import make_agent as _project_overview
from agents.requirements import make_agent as _requirements
from agents.user_stories import make_agent as _user_stories
from agents.architecture import make_agent as _architecture
from agents.api_spec import make_agent as _api_spec
from agents.data_model import make_agent as _data_model
from agents.devops import make_agent as _devops
from agents.testing_strategy import make_agent as _testing_strategy


def make_doc_agents() -> list[BaseAgent]:
    """Return all 8 documentation agents. Call once per run."""
    return [
        _project_overview(),
        _requirements(),
        _user_stories(),
        _architecture(),
        _api_spec(),
        _data_model(),
        _devops(),
        _testing_strategy(),
    ]


def make_doc_agents_core() -> list[BaseAgent]:
    """Return 6 core documentation agents (excludes Requirements and User Stories)."""
    return [
        _project_overview(),
        _architecture(),
        _api_spec(),
        _data_model(),
        _devops(),
        _testing_strategy(),
    ]
