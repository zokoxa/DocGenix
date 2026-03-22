from typing import Literal, Optional

from pydantic import BaseModel, Field


# -- Request/Response schemas --------------------------------------------------

class GenerateRequest(BaseModel):
    idea: str
    agent: str  # one of the 8 names or "all"
    project_id: Optional[int] = None


class ChatRequest(BaseModel):
    project_id: int
    message: str


# -- Agent output schemas ------------------------------------------------------

class ArchitectureReport(BaseModel):
    executive_summary: list[str]
    recommended_architecture: str
    cloud_infrastructure: str
    dev_tooling: str
    ai_llm_stack: str
    language_and_framework: str
    further_investigation: list[str]
    sources: list[str]


class ProjectOverviewDoc(BaseModel):
    project_name: str
    name_rationale: str
    what_is_this: str
    problem_statement: str
    target_users: list[str]
    key_features: list[str]
    positioning: str


class RequirementsDoc(BaseModel):
    functional_requirements: dict[str, list[str]]  # {area: ["FR-001: ..."]}
    non_functional_requirements: list[str]
    constraints: list[str]
    assumptions: list[str]
    out_of_scope: list[str]


class UserStoriesDoc(BaseModel):
    personas: list[str]
    epics: list[str]
    user_stories: list[str]


class ArchNode(BaseModel):
    id: str          # e.g. "api-gateway", "user-db"
    label: str       # short display name
    description: str # one-sentence responsibility
    technology: str  # e.g. "Next.js 16"
    node_type: Literal["frontend", "backend", "database", "queue", "external", "service"]
    layer: int       # 0=client, 1=edge/gateway, 2=services, 3=data, 4=external
    order: int       # position within the layer (0-indexed, top to bottom)


class ArchEdge(BaseModel):
    id: str      # e.g. "e-frontend-1-api-1"
    source: str  # node id
    target: str  # node id
    label: str   # protocol: "REST", "SQL", "WebSocket", "gRPC", etc.


class ArchitectureGraph(BaseModel):
    nodes: list[ArchNode] = Field(default_factory=list)
    edges: list[ArchEdge] = Field(default_factory=list)


class ERColumn(BaseModel):
    name: str          # e.g. "id", "email"
    type: str          # e.g. "UUID", "VARCHAR(255)"
    constraints: str   # e.g. "PK", "FK → users.id", "UQ, NOT NULL"


class ERNode(BaseModel):
    id: str            # e.g. "users", "orders"
    label: str         # e.g. "Users", "Orders"
    columns: list[ERColumn] = Field(default_factory=list)


class EREdge(BaseModel):
    id: str
    source: str        # node id
    target: str        # node id
    label: Literal["1:1", "1:M", "M:M"]  # cardinality — only these 3 values
    source_label: str  # e.g. "1", "*"
    target_label: str  # e.g. "*", "1"


class ERGraph(BaseModel):
    nodes: list[ERNode] = Field(default_factory=list)
    edges: list[EREdge] = Field(default_factory=list)


class ApiSpecDoc(BaseModel):
    auth_method: str
    base_url: str
    error_format: str
    endpoints: list[str]


class DataModelDoc(BaseModel):
    database_recommendation: str
    entities: list[str]
    relationships: list[str]
    er_diagram: str
    indexes: list[str]
    data_integrity_notes: str


class DevOpsDoc(BaseModel):
    cicd_platform: str
    pipeline_stages: list[str]
    containerization: str
    infrastructure: str
    environments: list[str]
    deployment_strategy: str
    secrets_management: str
    monitoring: str
    rollback_strategy: str


class TestingStrategyDoc(BaseModel):
    philosophy: str
    pyramid: list[str]
    unit_testing: str
    integration_testing: str
    e2e_scenarios: list[str]
    performance_testing: str
    security_testing: str
    test_data_management: str
    quality_gates: list[str]
