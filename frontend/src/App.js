import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MonacoEditor from '@monaco-editor/react';
import SplitPane from 'react-split-pane';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { Badge } from './components/ui/badge';
import { ScrollArea } from './components/ui/scroll-area';
import {
  Play,
  Upload,
  Save,
  FolderOpen,
  Settings,
  Download,
  RefreshCw,
  Plus,
  Code,
  Github,
  Zap,
  Monitor,
  Package,
  Cpu
} from 'lucide-react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [code, setCode] = useState(`#include <Arduino.h>

void setup() {
  // put your setup code here, to run once:
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  // put your main code here, to run repeatedly:
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
  Serial.println("Hello Arduino!");
}`);

  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [boards, setBoards] = useState([]);
  const [installedBoards, setInstalledBoards] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [installedLibraries, setInstalledLibraries] = useState([]);
  const [ports, setPorts] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState('arduino:avr:uno');
  const [selectedPort, setSelectedPort] = useState('');
  const [output, setOutput] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Dialog states
  const [showNewProject, setShowNewProject] = useState(false);
  const [showBoardManager, setShowBoardManager] = useState(false);
  const [showLibraryManager, setShowLibraryManager] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPublic, setNewProjectPublic] = useState(true);
  const [boardSearchQuery, setBoardSearchQuery] = useState('');
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  
  useEffect(() => {
    loadProjects();
    loadInstalledBoards();
    loadInstalledLibraries();
    loadPorts();
  }, []);

  const loadProjects = async () => {
    try {
      const response = await axios.get(`${API}/projects`);
      setProjects(response.data);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const loadInstalledBoards = async () => {
    try {
      const response = await axios.get(`${API}/boards/installed`);
      setInstalledBoards(response.data.output || '');
    } catch (error) {
      console.error('Failed to load installed boards:', error);
    }
  };

  const loadInstalledLibraries = async () => {
    try {
      const response = await axios.get(`${API}/libraries/installed`);
      setInstalledLibraries(response.data.output || '');
    } catch (error) {
      console.error('Failed to load installed libraries:', error);
    }
  };

  const loadPorts = async () => {
    try {
      const response = await axios.get(`${API}/ports`);
      if (response.data.success) {
        setPorts(response.data.output);
      }
    } catch (error) {
      console.error('Failed to load ports:', error);
    }
  };

  const searchBoards = async () => {
    try {
      const response = await axios.get(`${API}/boards/search?query=${boardSearchQuery}`);
      setBoards(response.data.output || '');
    } catch (error) {
      console.error('Failed to search boards:', error);
    }
  };

  const searchLibraries = async () => {
    try {
      const response = await axios.get(`${API}/libraries/search?query=${librarySearchQuery}`);
      setLibraries(response.data.output || '');
    } catch (error) {
      console.error('Failed to search libraries:', error);
    }
  };

  const installBoard = async (boardCore) => {
    try {
      const response = await axios.post(`${API}/boards/install`, { core: boardCore });
      if (response.data.success) {
        setOutput(prev => prev + `\n✓ ${response.data.message}`);
        loadInstalledBoards();
      } else {
        setOutput(prev => prev + `\n✗ Failed to install board: ${response.data.error}`);
      }
    } catch (error) {
      setOutput(prev => prev + `\n✗ Error installing board: ${error.message}`);
    }
  };

  const installLibrary = async (libraryName) => {
    try {
      const response = await axios.post(`${API}/libraries/install`, { library: libraryName });
      if (response.data.success) {
        setOutput(prev => prev + `\n✓ ${response.data.message}`);
        loadInstalledLibraries();
      } else {        setOutput(prev => prev + `\n✗ Failed to install library: ${response.data.error}`);
      }
    } catch (error) {
      setOutput(prev => prev + `\n✗ Error installing library: ${error.message}`);
    }
  };

  const compileSketch = async () => {
    if (isCompiling) return;
    
    setIsCompiling(true);
    setOutput('Compiling...\n');
    
    try {
      const response = await axios.post(`${API}/compile`, {
        code: code,
        board: selectedBoard
      });
      
      if (response.data.success) {
        setOutput(prev => prev + '✓ Compilation successful!\n' + response.data.output);
      } else {
        setOutput(prev => prev + '✗ Compilation failed:\n' + response.data.error);
      }
    } catch (error) {
      setOutput(prev => prev + '✗ Compilation error: ' + error.message);
    } finally {
      setIsCompiling(false);
    }
  };

  const uploadSketch = async () => {
    if (isUploading || !selectedPort) {
      setOutput(prev => prev + '\n✗ Please select a port first');
      return;
    }
    
    setIsUploading(true);
    setOutput(prev => prev + '\nUploading...\n');
    
    try {
      const response = await axios.post(`${API}/upload`, {
        code: code,
        board: selectedBoard,
        port: selectedPort
      });
      
      if (response.data.success) {
        setOutput(prev => prev + '✓ Upload successful!\n' + response.data.output);
      } else {
        setOutput(prev => prev + '✗ Upload failed:\n' + response.data.error);
      }
    } catch (error) {
      setOutput(prev => prev + '✗ Upload error: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    
    try {
      const response = await axios.post(`${API}/projects`, {
        name: newProjectName,
        code: code,
        is_public: newProjectPublic
      });
      
      setCurrentProject(response.data);
      setOutput(prev => prev + `\n✓ Project "${newProjectName}" created with GitHub repository!`);
      setNewProjectName('');
      setShowNewProject(false);
      loadProjects();
    } catch (error) {
      setOutput(prev => prev + `\n✗ Failed to create project: ${error.message}`);
    }
  };

  const loadProject = async (project) => {
    try {
      const response = await axios.get(`${API}/projects/${project.id}`);
      setCurrentProject(response.data);
      setCode(response.data.code);
      setOutput(`✓ Loaded project: ${response.data.name}`);
    } catch (error) {
      setOutput(prev => prev + `\n✗ Failed to load project: ${error.message}`);
    }
  };

  const saveProject = async () => {
    if (!currentProject) {
      setOutput(prev => prev + '\n✗ No project selected');
      return;
    }
    
    try {
      await axios.put(`${API}/projects/${currentProject.id}?code=${encodeURIComponent(code)}`);
      setOutput(prev => prev + `\n✓ Project saved to GitHub!`);
    } catch (error) {
      setOutput(prev => prev + `\n✗ Failed to save project: ${error.message}`);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">Arduino IDE</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              onClick={compileSketch} 
              disabled={isCompiling}
              variant="outline" 
              size="sm"
              className="flex items-center gap-2"
            >
              {isCompiling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Compile
            </Button>
            
            <Button 
              onClick={uploadSketch} 
              disabled={isUploading || !selectedPort}
              variant="default" 
              size="sm"
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
            >
              {isUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedBoard} onValueChange={setSelectedBoard}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select Board" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="arduino:avr:uno">Arduino Uno</SelectItem>
              <SelectItem value="arduino:avr:nano">Arduino Nano</SelectItem>
              <SelectItem value="arduino:avr:mega">Arduino Mega</SelectItem>
              <SelectItem value="esp32:esp32:esp32">ESP32</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedPort} onValueChange={setSelectedPort}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Port" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="/dev/ttyUSB0">/dev/ttyUSB0</SelectItem>
              <SelectItem value="/dev/ttyUSB1">/dev/ttyUSB1</SelectItem>
              <SelectItem value="/dev/ttyACM0">/dev/ttyACM0</SelectItem>
              <SelectItem value="COM1">COM1</SelectItem>
              <SelectItem value="COM2">COM2</SelectItem>
              <SelectItem value="COM3">COM3</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="projectName">Project Name</Label>
                    <Input
                      id="projectName"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="My Arduino Project"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="isPublic"
                      checked={newProjectPublic}
                      onChange={(e) => setNewProjectPublic(e.target.checked)}
                    />
                    <Label htmlFor="isPublic">Public Repository</Label>
                  </div>
                  <Button onClick={createProject} className="w-full">
                    <Github className="h-4 w-4 mr-2" />
                    Create Project & GitHub Repo
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button variant="outline" size="sm" onClick={saveProject} disabled={!currentProject}>
              <Save className="h-4 w-4" />
            </Button>

            <Dialog open={showBoardManager} onOpenChange={setShowBoardManager}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Board Manager</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="installed">
                  <TabsList>
                    <TabsTrigger value="installed">Installed</TabsTrigger>
                    <TabsTrigger value="search">Search & Install</TabsTrigger>
                  </TabsList>
                  <TabsContent value="installed">
                    <ScrollArea className="h-64">
                      <pre className="text-sm">{installedBoards}</pre>
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="search">
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search boards..."
                          value={boardSearchQuery}
                          onChange={(e) => setBoardSearchQuery(e.target.value)}
                        />
                        <Button onClick={searchBoards}>Search</Button>
                      </div>
                      <ScrollArea className="h-64">
                        <pre className="text-sm">{boards}</pre>
                      </ScrollArea>
                    </div>
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>

            <Dialog open={showLibraryManager} onOpenChange={setShowLibraryManager}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Package className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Library Manager</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="installed">
                  <TabsList>
                    <TabsTrigger value="installed">Installed</TabsTrigger>
                    <TabsTrigger value="search">Search & Install</TabsTrigger>
                  </TabsList>
                  <TabsContent value="installed">
                    <ScrollArea className="h-64">
                      <pre className="text-sm">{installedLibraries}</pre>
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="search">
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search libraries..."
                          value={librarySearchQuery}
                          onChange={(e) => setLibrarySearchQuery(e.target.value)}
                        />
                        <Button onClick={searchLibraries}>Search</Button>
                      </div>
                      <ScrollArea className="h-64">
                        <pre className="text-sm">{libraries}</pre>
                      </ScrollArea>
                    </div>
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-2">Projects</h3>
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => loadProject(project)}
                  className={`p-2 rounded cursor-pointer text-sm transition-colors ${
                    currentProject?.id === project.id
                      ? 'bg-blue-100 text-blue-800'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    <span className="truncate">{project.name}</span>
                  </div>
                  {project.github_repo && (
                    <Badge variant="secondary" className="mt-1 text-xs">
                      <Github className="h-3 w-3 mr-1" />
                      GitHub
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2">Status</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                <span>Board: {selectedBoard.split(':').pop()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                <span>Port: {selectedPort || 'None'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Editor and Output */}
        <div className="flex-1">
          <SplitPane split="horizontal" defaultSize="60%" minSize={200}>
            <div className="h-full bg-white">
              <div className="h-8 bg-gray-100 border-b border-gray-200 flex items-center px-4 text-sm text-gray-600">
                <Code className="h-4 w-4 mr-2" />
                {currentProject ? `${currentProject.name}.ino` : 'sketch.ino'}
              </div>
              <MonacoEditor
                height="calc(100% - 2rem)"
                language="cpp"
                theme="vs-light"
                value={code}
                onChange={(value) => setCode(value || '')}
                options={{
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 14,
                  lineNumbers: 'on',
                  roundedSelection: false,
                  automaticLayout: true,
                }}
              />
            </div>
            
            <div className="bg-gray-900 text-green-400 font-mono">
              <div className="h-8 bg-gray-800 border-b border-gray-700 flex items-center px-4 text-sm">
                <Monitor className="h-4 w-4 mr-2" />
                Output
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOutput('')}
                  className="ml-auto text-gray-400 hover:text-white"
                >
                  Clear
                </Button>
              </div>
              <ScrollArea className="h-full p-4">
                <pre className="text-sm whitespace-pre-wrap">{output}</pre>
              </ScrollArea>
            </div>
          </SplitPane>
        </div>
      </div>
    </div>
  );
}

export default App;