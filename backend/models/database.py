import aiosqlite
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "docbot.db"


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                idea TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                agent_name TEXT NOT NULL,
                markdown TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS project_context (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
                context TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        await db.commit()
        # Idempotent migration: add arch_graph column if it doesn't exist yet
        try:
            await db.execute("ALTER TABLE documents ADD COLUMN arch_graph TEXT")
            await db.commit()
        except Exception:
            pass  # column already exists


async def create_project(idea: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("INSERT INTO projects (idea) VALUES (?)", (idea,))
        await db.commit()
        return cursor.lastrowid


async def get_projects() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT id, idea, created_at FROM projects ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def save_document(project_id: int, agent_name: str, markdown: str, arch_graph: str | None = None) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO documents (project_id, agent_name, markdown, arch_graph) VALUES (?, ?, ?, ?)",
            (project_id, agent_name, markdown, arch_graph),
        )
        await db.commit()
        return cursor.lastrowid


async def update_document_markdown(doc_id: int, markdown: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE documents SET markdown = ? WHERE id = ?",
            (markdown, doc_id),
        )
        await db.commit()


async def update_document_graph(doc_id: int, arch_graph: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE documents SET arch_graph = ? WHERE id = ?",
            (arch_graph, doc_id),
        )
        await db.commit()


async def get_documents(project_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, project_id, agent_name, markdown, arch_graph, created_at FROM documents WHERE project_id = ? ORDER BY created_at",
            (project_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_document_by_id(doc_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, project_id, agent_name, markdown, arch_graph, created_at FROM documents WHERE id = ?",
            (doc_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def save_chat_message(project_id: int, role: str, content: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO chat_messages (project_id, role, content) VALUES (?, ?, ?)",
            (project_id, role, content),
        )
        await db.commit()
        return cursor.lastrowid


async def save_project_context(project_id: int, context: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO project_context (project_id, context, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (project_id, context),
        )
        await db.commit()


async def get_project_context(project_id: int) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT context FROM project_context WHERE project_id = ?",
            (project_id,),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


async def get_project_idea(project_id: int) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT idea FROM projects WHERE id = ?",
            (project_id,),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


async def delete_project(project_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM project_context WHERE project_id = ?", (project_id,))
        await db.execute("DELETE FROM chat_messages WHERE project_id = ?", (project_id,))
        await db.execute("DELETE FROM documents WHERE project_id = ?", (project_id,))
        await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await db.commit()


async def get_chat_history(project_id: int, limit: int = 20) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, project_id, role, content, created_at FROM chat_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
            (project_id, limit),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in reversed(rows)]
