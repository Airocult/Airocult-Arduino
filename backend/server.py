from fastapi import FastAPI, APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import subprocess
import asyncio
import json
import tempfile
import shutil
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
import aiofiles
from github import Github
import io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Arduino CLI Path
ARDUINO_CLI_PATH = "/app/arduino-cli/bin/arduino-cli"

# GitHub Token
GITHUB_TOKEN = "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"
github_client = Github(GITHUB_TOKEN)

# Models
class ArduinoProject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    code: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    github_repo: Optional[str] = None
    is_public: bool = True

class CreateProjectRequest(BaseModel):
    name: str
    code: str = "#include <Arduino.h>\n\nvoid setup() {\n  // put your setup code here, to run once:\n  \n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n  \n}"
    is_public: bool = True

class CompileRequest(BaseModel):
    code: str
    board: str = "arduino:avr:uno"

class UploadRequest(BaseModel):
    code: str
    board: str = "arduino:avr:uno"
    port: str

class BoardInstallRequest(BaseModel):
    core: str

class LibraryInstallRequest(BaseModel):
    library: str

# Helper functions
async def run_arduino_cli(args: List[str]) -> tuple[int, str, str]:
    """Run arduino-cli command and return (returncode, stdout, stderr)"""
    try:
        cmd = [ARDUINO_CLI_PATH] + args
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, 'PATH': f"/app/arduino-cli/bin:{os.environ.get('PATH', '')}"}
        )
        stdout, stderr = await process.communicate()
        return process.returncode, stdout.decode(), stderr.decode()
    except Exception as e:
        return 1, "", str(e)

async def create_github_repo(name: str, is_public: bool = True) -> str:
    """Create a GitHub repository and return the repo URL"""
    try:
        user = github_client.get_user()
        repo = user.create_repo(name, private=not is_public)
        return repo.html_url
    except Exception as e:
        logging.error(f"Failed to create GitHub repo: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create GitHub repository: {str(e)}")

async def save_to_github(repo_name: str, filename: str, content: str, commit_message: str = "Update Arduino code"):
    """Save file to GitHub repository"""
    try:
        user = github_client.get_user()
        repo = user.get_repo(repo_name)
        
        try:
            # Try to get existing file
            file = repo.get_contents(filename)
            repo.update_file(filename, commit_message, content, file.sha)
        except:
            # File doesn't exist, create new
            repo.create_file(filename, commit_message, content)
    except Exception as e:
        logging.error(f"Failed to save to GitHub: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save to GitHub: {str(e)}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Arduino IDE API"}

@api_router.get("/boards/search")
async def search_boards(query: str = ""):
    """Search for available Arduino boards"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["core", "search", query])
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/boards/installed")
async def list_installed_boards():
    """List installed Arduino boards"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["core", "list"])
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/boards/install")
async def install_board(request: BoardInstallRequest):
    """Install Arduino board package"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["core", "install", request.core])
        if returncode == 0:
            return {"success": True, "message": f"Board {request.core} installed successfully"}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/libraries/search")
async def search_libraries(query: str = ""):
    """Search for Arduino libraries"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["lib", "search", query])
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/libraries/installed")
async def list_installed_libraries():
    """List installed Arduino libraries"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["lib", "list"])
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/libraries/install")
async def install_library(request: LibraryInstallRequest):
    """Install Arduino library"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["lib", "install", request.library])
        if returncode == 0:
            return {"success": True, "message": f"Library {request.library} installed successfully"}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/ports")
async def list_ports():
    """List available COM/serial ports"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["board", "list"])
        if returncode == 0:
            return {"success": True, "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/compile")
async def compile_sketch(request: CompileRequest):
    """Compile Arduino sketch"""
    try:
        # Create temporary directory for sketch
        with tempfile.TemporaryDirectory() as temp_dir:
            sketch_dir = Path(temp_dir) / "sketch"
            sketch_dir.mkdir()
            
            # Write sketch file
            sketch_file = sketch_dir / "sketch.ino"
            async with aiofiles.open(sketch_file, 'w') as f:
                await f.write(request.code)
            
            # Compile
            returncode, stdout, stderr = await run_arduino_cli([
                "compile", 
                "--fqbn", request.board,
                str(sketch_dir)
            ])
            
            if returncode == 0:
                return {"success": True, "message": "Compilation successful", "output": stdout}
            else:
                return {"success": False, "error": stderr, "output": stdout}
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/upload")
async def upload_sketch(request: UploadRequest):
    """Upload Arduino sketch to board"""
    try:
        # Create temporary directory for sketch
        with tempfile.TemporaryDirectory() as temp_dir:
            sketch_dir = Path(temp_dir) / "sketch"
            sketch_dir.mkdir()
            
            # Write sketch file
            sketch_file = sketch_dir / "sketch.ino"
            async with aiofiles.open(sketch_file, 'w') as f:
                await f.write(request.code)
            
            # Upload
            returncode, stdout, stderr = await run_arduino_cli([
                "upload", 
                "--fqbn", request.board,
                "--port", request.port,
                str(sketch_dir)
            ])
            
            if returncode == 0:
                return {"success": True, "message": "Upload successful", "output": stdout}
            else:
                return {"success": False, "error": stderr, "output": stdout}
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/projects", response_model=ArduinoProject)
async def create_project(request: CreateProjectRequest):
    """Create a new Arduino project with GitHub repository"""
    try:
        # Create GitHub repository first
        repo_url = await create_github_repo(request.name, request.is_public)
        repo_name = repo_url.split('/')[-1]
        
        # Create project document
        project = ArduinoProject(
            name=request.name,
            code=request.code,
            github_repo=repo_url,
            is_public=request.is_public
        )
        
        # Save to MongoDB
        await db.projects.insert_one(project.dict())
        
        # Save initial code to GitHub
        await save_to_github(repo_name, f"{request.name}.ino", request.code, "Initial Arduino sketch")
        
        return project
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/projects", response_model=List[ArduinoProject])
async def list_projects():
    """List all Arduino projects"""
    try:
        projects = await db.projects.find().to_list(100)
        return [ArduinoProject(**project) for project in projects]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/projects/{project_id}", response_model=ArduinoProject)
async def get_project(project_id: str):
    """Get a specific Arduino project"""
    try:
        project = await db.projects.find_one({"id": project_id})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return ArduinoProject(**project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/projects/{project_id}", response_model=ArduinoProject)
async def update_project(project_id: str, code: str):
    """Update Arduino project code and save to GitHub"""
    try:
        project = await db.projects.find_one({"id": project_id})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Update in MongoDB
        await db.projects.update_one(
            {"id": project_id},
            {"$set": {"code": code, "updated_at": datetime.utcnow()}}
        )
        
        # Save to GitHub if repo exists
        if project.get('github_repo'):
            repo_name = project['github_repo'].split('/')[-1]
            await save_to_github(repo_name, f"{project['name']}.ino", code, "Update Arduino sketch")
        
        # Return updated project
        updated_project = await db.projects.find_one({"id": project_id})
        return ArduinoProject(**updated_project)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete Arduino project"""
    try:
        result = await db.projects.delete_one({"id": project_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"success": True, "message": "Project deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()