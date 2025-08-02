from fastapi import FastAPI, APIRouter, HTTPException, status, WebSocket, WebSocketDisconnect, Depends, Request
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import subprocess
import asyncio
import json
import tempfile
import shutil
import serial
import serial.tools.list_ports
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import aiofiles
import requests
import jwt
from github import Github
import io
import re
import time
import urllib.parse

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Add session middleware
app.add_middleware(SessionMiddleware, secret_key=os.environ['JWT_SECRET'])

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Arduino CLI Path
ARDUINO_CLI_PATH = "/app/arduino-cli/bin/arduino-cli"

# GitHub OAuth Configuration
GITHUB_CLIENT_ID = os.environ['GITHUB_CLIENT_ID']
GITHUB_CLIENT_SECRET = os.environ['GITHUB_CLIENT_SECRET']
JWT_SECRET = os.environ['JWT_SECRET']

# Serial connection manager
serial_connections = {}

# Security
security = HTTPBearer(auto_error=False)

# Models
class ArduinoProject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    code: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    github_repo: Optional[str] = None
    is_public: bool = True
    user_id: str

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

class SerialRequest(BaseModel):
    port: str
    baud_rate: int = 9600

class User(BaseModel):
    id: str
    username: str
    avatar_url: str
    access_token: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class GitHubOAuthResponse(BaseModel):
    access_token: str
    token_type: str
    scope: str

# Helper functions
async def run_arduino_cli(args: List[str]) -> tuple[int, str, str]:
    """Run arduino-cli command and return (returncode, stdout, stderr)"""
    try:
        cmd = [ARDUINO_CLI_PATH] + args
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={
                **os.environ, 
                'PATH': f"/app/arduino-cli/bin:{os.environ.get('PATH', '')}",
                'HOME': '/root'
            }
        )
        stdout, stderr = await process.communicate()
        return process.returncode, stdout.decode(), stderr.decode()
    except Exception as e:
        return 1, "", str(e)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Optional[User]:
    """Get current authenticated user from JWT token"""
    if not credentials:
        return None
    
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        user_data = await db.users.find_one({"id": payload["user_id"]})
        if user_data:
            return User(**user_data)
    except:
        pass
    return None

async def require_auth(user: User = Depends(get_current_user)) -> User:
    """Require authentication"""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user

def create_github_client(access_token: str) -> Github:
    """Create GitHub client with user's access token"""
    return Github(access_token)

async def create_github_repo(user: User, name: str, is_public: bool = True) -> str:
    """Create a GitHub repository and return the repo URL"""
    try:
        github_client = create_github_client(user.access_token)
        github_user = github_client.get_user()
        repo = github_user.create_repo(name, private=not is_public)
        return repo.html_url
    except Exception as e:
        logging.error(f"Failed to create GitHub repo: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create GitHub repository: {str(e)}")

async def save_to_github(user: User, repo_name: str, filename: str, content: str, commit_message: str = "Update Arduino code"):
    """Save file to GitHub repository"""
    try:
        github_client = create_github_client(user.access_token)
        github_user = github_client.get_user()
        repo = github_user.get_repo(repo_name)
        
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

def parse_board_list(output: str) -> List[Dict]:
    """Parse Arduino CLI board list output"""
    boards = []
    lines = output.strip().split('\n')
    for line in lines[1:]:  # Skip header
        if line.strip():
            parts = line.split()
            if len(parts) >= 3:
                boards.append({
                    "id": parts[0],
                    "version": parts[1] if parts[1] != "n/a" else None,
                    "name": " ".join(parts[2:])
                })
    return boards

def parse_library_list(output: str) -> List[Dict]:
    """Parse Arduino CLI library list output"""
    libraries = []
    current_lib = {}
    
    for line in output.split('\n'):
        line = line.strip()
        if line.startswith('Name: '):
            if current_lib:
                libraries.append(current_lib)
            current_lib = {"name": line[6:].strip('"')}
        elif line.startswith('  Author: '):
            current_lib["author"] = line[10:]
        elif line.startswith('  Sentence: '):
            current_lib["description"] = line[12:]
        elif line.startswith('  Versions: '):
            versions_str = line[12:]
            if versions_str.startswith('[') and versions_str.endswith(']'):
                try:
                    current_lib["versions"] = eval(versions_str)
                except:
                    current_lib["versions"] = []
    
    if current_lib:
        libraries.append(current_lib)
    
    return libraries

# GitHub OAuth Routes
@api_router.get("/auth/github")
async def github_auth():
    """Initiate GitHub OAuth flow"""
    github_auth_url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&redirect_uri={urllib.parse.quote('https://ee41e7d3-c394-4a4c-a85b-a9158bf4d678.preview.emergentagent.com/api/auth/github/callback')}"
        f"&scope=repo,user:email"
        f"&state={str(uuid.uuid4())}"
    )
    return {"auth_url": github_auth_url}

@api_router.get("/auth/github/callback")
async def github_callback(code: str, state: str):
    """Handle GitHub OAuth callback"""
    try:
        # Exchange code for access token
        token_response = requests.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
            }
        )
        
        token_data = token_response.json()
        access_token = token_data.get("access_token")
        
        if not access_token:
            raise HTTPException(status_code=400, detail="Failed to get access token")
        
        # Get user info from GitHub
        user_response = requests.get(
            "https://api.github.com/user",
            headers={"Authorization": f"token {access_token}"}
        )
        user_data = user_response.json()
        
        # Create or update user in database
        user = User(
            id=str(user_data["id"]),
            username=user_data["login"],
            avatar_url=user_data["avatar_url"],
            access_token=access_token
        )
        
        # Upsert user in database
        await db.users.update_one(
            {"id": user.id},
            {"$set": user.dict()},
            upsert=True
        )
        
        # Create JWT token
        jwt_payload = {
            "user_id": user.id,
            "username": user.username,
            "exp": datetime.utcnow() + timedelta(days=30)
        }
        jwt_token = jwt.encode(jwt_payload, JWT_SECRET, algorithm="HS256")
        
        # Redirect to frontend with token
        return RedirectResponse(
            url=f"/?token={jwt_token}&user={user.username}",
            status_code=302
        )
        
    except Exception as e:
        logging.error(f"GitHub OAuth error: {e}")
        return RedirectResponse(url="/?error=auth_failed", status_code=302)

@api_router.get("/auth/user")
async def get_user_info(user: User = Depends(get_current_user)):
    """Get current user information"""
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    return {
        "id": user.id,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "authenticated": True
    }

@api_router.post("/auth/logout")
async def logout():
    """Logout user"""
    return {"message": "Logged out successfully"}

# Arduino Routes
@api_router.get("/")
async def root():
    return {"message": "Arduino IDE API"}

@api_router.get("/boards/search")
async def search_boards(query: str = ""):
    """Search for available Arduino boards"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["core", "search", query])
        if returncode == 0:
            boards = parse_board_list(stdout)
            return {"success": True, "boards": boards, "raw_output": stdout}
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
            boards = parse_board_list(stdout)
            return {"success": True, "boards": boards, "raw_output": stdout}
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
            return {"success": True, "message": f"Board {request.core} installed successfully", "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/boards/uninstall")
async def uninstall_board(request: BoardInstallRequest):
    """Uninstall Arduino board package"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["core", "uninstall", request.core])
        if returncode == 0:
            return {"success": True, "message": f"Board {request.core} uninstalled successfully", "output": stdout}
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
            libraries = parse_library_list(stdout)
            return {"success": True, "libraries": libraries, "raw_output": stdout}
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
            libraries = parse_library_list(stdout)
            return {"success": True, "libraries": libraries, "raw_output": stdout}
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
            return {"success": True, "message": f"Library {request.library} installed successfully", "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/libraries/uninstall")
async def uninstall_library(request: LibraryInstallRequest):
    """Uninstall Arduino library"""
    try:
        returncode, stdout, stderr = await run_arduino_cli(["lib", "uninstall", request.library])
        if returncode == 0:
            return {"success": True, "message": f"Library {request.library} uninstalled successfully", "output": stdout}
        else:
            return {"success": False, "error": stderr}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/ports")
async def list_ports():
    """List available COM/serial ports"""
    try:
        # Try Arduino CLI first
        returncode, stdout, stderr = await run_arduino_cli(["board", "list"])
        
        # Also try pyserial for additional port detection
        available_ports = []
        try:
            ports = serial.tools.list_ports.comports()
            for port in ports:
                available_ports.append({
                    "device": port.device,
                    "description": port.description,
                    "hwid": port.hwid
                })
        except:
            pass
        
        if returncode == 0:
            return {"success": True, "arduino_cli_output": stdout, "detected_ports": available_ports}
        else:
            return {"success": True, "arduino_cli_output": "No boards detected", "detected_ports": available_ports}
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

@api_router.post("/serial/connect")
async def connect_serial(request: SerialRequest):
    """Connect to serial port"""
    try:
        if request.port in serial_connections:
            serial_connections[request.port].close()
        
        ser = serial.Serial(request.port, request.baud_rate, timeout=0.1)
        serial_connections[request.port] = ser
        
        return {"success": True, "message": f"Connected to {request.port} at {request.baud_rate} baud"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@api_router.post("/serial/disconnect")
async def disconnect_serial(port: str):
    """Disconnect from serial port"""
    try:
        if port in serial_connections:
            serial_connections[port].close()
            del serial_connections[port]
        return {"success": True, "message": f"Disconnected from {port}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@api_router.post("/serial/send")
async def send_serial(port: str, data: str):
    """Send data to serial port"""
    try:
        if port not in serial_connections:
            return {"success": False, "error": "Port not connected"}
        
        ser = serial_connections[port]
        ser.write((data + '\n').encode())
        return {"success": True, "message": "Data sent"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# WebSocket for real-time serial data
@app.websocket("/ws/serial/{port}")
async def websocket_serial(websocket: WebSocket, port: str):
    await websocket.accept()
    
    try:
        while True:
            if port in serial_connections:
                ser = serial_connections[port]
                try:
                    if ser.in_waiting > 0:
                        data = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                        await websocket.send_text(json.dumps({
                            "type": "data",
                            "data": data,
                            "timestamp": time.time()
                        }))
                except:
                    pass
            
            await asyncio.sleep(0.1)
            
    except WebSocketDisconnect:
        pass

# Project Routes (Require Authentication)
@api_router.post("/projects", response_model=ArduinoProject)
async def create_project(request: CreateProjectRequest, user: User = Depends(require_auth)):
    """Create a new Arduino project with GitHub repository"""
    try:
        # Create GitHub repository first
        repo_url = await create_github_repo(user, request.name, request.is_public)
        repo_name = repo_url.split('/')[-1]
        
        # Create project document
        project = ArduinoProject(
            name=request.name,
            code=request.code,
            github_repo=repo_url,
            is_public=request.is_public,
            user_id=user.id
        )
        
        # Save to MongoDB
        await db.projects.insert_one(project.dict())
        
        # Save initial code to GitHub
        await save_to_github(user, repo_name, f"{request.name}.ino", request.code, "Initial Arduino sketch")
        
        return project
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/projects", response_model=List[ArduinoProject])
async def list_projects(user: User = Depends(require_auth)):
    """List user's Arduino projects"""
    try:
        projects = await db.projects.find({"user_id": user.id}).to_list(100)
        return [ArduinoProject(**project) for project in projects]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/projects/{project_id}", response_model=ArduinoProject)
async def get_project(project_id: str, user: User = Depends(require_auth)):
    """Get a specific Arduino project"""
    try:
        project = await db.projects.find_one({"id": project_id, "user_id": user.id})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return ArduinoProject(**project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/projects/{project_id}", response_model=ArduinoProject)
async def update_project(project_id: str, code: str, user: User = Depends(require_auth)):
    """Update Arduino project code and save to GitHub"""
    try:
        project = await db.projects.find_one({"id": project_id, "user_id": user.id})
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Update in MongoDB
        await db.projects.update_one(
            {"id": project_id, "user_id": user.id},
            {"$set": {"code": code, "updated_at": datetime.utcnow()}}
        )
        
        # Save to GitHub if repo exists
        if project.get('github_repo'):
            repo_name = project['github_repo'].split('/')[-1]
            await save_to_github(user, repo_name, f"{project['name']}.ino", code, "Update Arduino sketch")
        
        # Return updated project
        updated_project = await db.projects.find_one({"id": project_id, "user_id": user.id})
        return ArduinoProject(**updated_project)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: User = Depends(require_auth)):
    """Delete Arduino project"""
    try:
        result = await db.projects.delete_one({"id": project_id, "user_id": user.id})
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
    # Close all serial connections
    for port, ser in serial_connections.items():
        try:
            ser.close()
        except:
            pass
    client.close()