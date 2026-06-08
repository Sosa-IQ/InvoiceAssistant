from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    openai_api_key: str = ""
    speechmatics_api_key: str = ""
    data_dir: Path = Path("./data")
    chroma_dir: Path = Path("./data/chroma")
    db_path: Path = Path("./data/app.db")
    database_url: str = ""
    legacy_sqlite_path: Path = Path("./data/app.db")
    max_upload_size_mb: int = 20
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "invoices"
    bootstrap_user_email: str = "owner@example.com"
    bootstrap_user_password: str = "ChangeMe123!"
    migrate_local_data: bool = False

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite+aiosqlite:///{self.db_path}"

    @property
    def invoices_dir(self) -> Path:
        return self.data_dir / "invoices"


settings = Settings()
