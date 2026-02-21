from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    anthropic_api_key: str = ""
    data_dir: Path = Path("./data")
    chroma_dir: Path = Path("./data/chroma")
    db_path: Path = Path("./data/app.db")
    max_upload_size_mb: int = 20

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def invoices_dir(self) -> Path:
        return self.data_dir / "invoices"


settings = Settings()
