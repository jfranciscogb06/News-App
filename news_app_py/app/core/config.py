from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import PostgresDsn, validator


class Settings(BaseSettings):
    PROJECT_NAME: str = "News Analysis App"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: PostgresDsn
    
    # OpenAI
    OPENAI_API_KEY: str
    
    # Security
    SECRET_KEY: str
    
    # Logging
    LOG_LEVEL: str = "info"
    
    # Server
    PORT: int = 8000
    
    @validator("DEBUG", pre=True)
    def get_debug(cls, v: Optional[bool], values: dict) -> bool:
        if v is not None:
            return v
        return values.get("ENVIRONMENT", "development") == "development"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings() 