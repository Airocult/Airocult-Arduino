import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import MonacoEditor from '@monaco-editor/react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { Badge } from './components/ui/badge';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';
import { Switch } from './components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar';
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
  Cpu,
  Terminal,
  Activity,
  ChevronDown,
  ChevronUp,
  X,
  Search,
  BarChart3,
  Wifi,
  WifiOff,
  Send,
  Trash2,
  InstallIcon,
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
  User
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
  Serial.println("Arduino Started!");
}

void loop() {
  // put your main code here, to run repeatedly:
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
  Serial.println("Hello Arduino!");
}`);

  // Authentication state
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState(localStorage.getItem('arduino_auth_token'));

  // State management
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [boards, setBoards] = useState([]);
  const [installedBoards, setInstalledBoards] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [installedLibraries, setInstalledLibraries] = useState([]);
  const [ports, setPorts] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState('arduino:avr:uno');
  const [selectedPort, setSelectedPort] = useState('');
  const [selectedBaudRate, setSelectedBaudRate] = useState(9600);
  const [output, setOutput] = useState('Arduino IDE Ready\n');
  const [serialOutput, setSerialOutput] = useState('');
  const [serialPlotterData, setSerialPlotterData] = useState([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSerialConnected, setIsSerialConnected] = useState(false);

  // Dialog states
  const [showNewProject, setShowNewProject] = useState(false);
  const [showBoardManager, setShowBoardManager] = useState(false);
  const [showLibraryManager, setShowLibraryManager] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPublic, setNewProjectPublic] = useState(true);
  const [boardSearchQuery, setBoardSearchQuery] = useState('');
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [serialInput, setSerialInput] = useState('');

  // Panel visibility states
  const [showSidebar, setShowSidebar] = useState(true);
  const [showConsole, setShowConsole] = useState(true);
  const [showSerial, setShowSerial] = useState(false);
  const [showPlotter, setShowPlotter] = useState(false);
  const [consoleTab, setConsoleTab] = useState('compiler');

  // Layout state
  const [editorHeight, setEditorHeight] = useState(60);
  const [sidebarWidth, setSidebarWidth] = useState(260);

  // Refs
  const wsRef = useRef(null);
  const plotterCanvasRef = useRef(null);

  // Set up axios defaults
  useEffect(() => {
    if (authToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [authToken]);

  // Check for auth token in URL (OAuth redirect)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const username = urlParams.get('user');
    const error = urlParams.get('error');

    if (token && username) {
      setAuthToken(token);
      localStorage.setItem('arduino_auth_token', token);
      setUser({ username });
      setIsAuthenticated(true);
      setOutput(prev => prev + `\n✓ Signed in as ${username}\n`);
      
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (error) {
      setOutput(prev => prev + '\n✗ GitHub authentication failed\n');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Load user info if token exists
  useEffect(() => {
    if (authToken && !user) {
      loadUserInfo();
    }
  }, [authToken, user]);

  useEffect(() => {
    if (isAuthenticated) {
      loadProjects();
    }
    loadInstalledBoards();
    loadInstalledLibraries();
    loadPorts();
  }, [isAuthenticated]);

  // WebSocket for serial communication
  useEffect(() => {
    if (isSerialConnected && selectedPort) {
      const wsUrl = `ws://${window.location.host.replace('https://', '').replace('http://', '')}/ws/serial/${encodeURIComponent(selectedPort)}`;
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'data') {
          setSerialOutput(prev => prev + message.data);
          
          // Parse numeric data for plotter
          const lines = message.data.split('\n');
          lines.forEach(line => {
            const numMatch = line.match(/(-?\d+\.?\d*)/);
            if (numMatch) {
              const value = parseFloat(numMatch[1]);
              setSerialPlotterData(prev => [...prev.slice(-100), { x: Date.now(), y: value }]);
            }
          });
        }
      };

      return () => {
        if (wsRef.current) {
          wsRef.current.close();
        }
      };
    }
  }, [isSerialConnected, selectedPort]);

  const loadUserInfo = async () => {
    try {
      const response = await axios.get(`${API}/auth/user`);
      setUser(response.data);
      setIsAuthenticated(true);
    } catch (error) {
      // Token is invalid, clear it
      setAuthToken(null);
      localStorage.removeItem('arduino_auth_token');
      setIsAuthenticated(false);
      setUser(null);
    }
  };

  const initiateGitHubAuth = async () => {
    try {
      const response = await axios.get(`${API}/auth/github`);
      window.location.href = response.data.auth_url;
    } catch (error) {
      setOutput(prev => prev + `\n✗ Failed to initiate GitHub authentication: ${error.message}\n`);
    }
  };

  const logout = () => {
    setAuthToken(null);
    localStorage.removeItem('arduino_auth_token');
    setIsAuthenticated(false);
    setUser(null);
    setProjects([]);
    setCurrentProject(null);
    setOutput(prev => prev + '\n✓ Signed out\n');
    delete axios.defaults.headers.common['Authorization'];
  };

  const loadProjects = async () => {
    if (!isAuthenticated) return;
    
    try {
      const response = await axios.get(`${API}/projects`);
      setProjects(response.data);
    } catch (error) {
      console.error('Failed to load projects:', error);
      if (error.response?.status === 401) {
        logout();
      }
    }
  };

  const loadInstalledBoards = async () => {
    try {
      const response = await axios.get(`${API}/boards/installed`);
      setInstalledBoards(response.data.boards || []);
    } catch (error) {
      console.error('Failed to load installed boards:', error);
    }
  };

  const loadInstalledLibraries = async () => {
    try {
      const response = await axios.get(`${API}/libraries/installed`);
      setInstalledLibraries(response.data.libraries || []);
    } catch (error) {
      console.error('Failed to load installed libraries:', error);
    }
  };

  const loadPorts = async () => {
    try {
      const response = await axios.get(`${API}/ports`);
      if (response.data.success) {
        setPorts(response.data.detected_ports || []);
      }
    } catch (error) {
      console.error('Failed to load ports:', error);
    }
  };

  const searchBoards = async () => {
    try {
      setOutput(prev => prev + `\nSearching for boards: ${boardSearchQuery}...\n`);
      const response = await axios.get(`${API}/boards/search?query=${boardSearchQuery}`);
      setBoards(response.data.boards || []);
      setOutput(prev => prev + `✓ Found ${response.data.boards?.length || 0} boards\n`);
    } catch (error) {
      setOutput(prev => prev + `✗ Error searching boards: ${error.message}\n`);
    }
  };

  const searchLibraries = async () => {
    try {
      setOutput(prev => prev + `\nSearching for libraries: ${librarySearchQuery}...\n`);
      const response = await axios.get(`${API}/libraries/search?query=${librarySearchQuery}`);
      setLibraries(response.data.libraries || []);
      setOutput(prev => prev + `✓ Found ${response.data.libraries?.length || 0} libraries\n`);
    } catch (error) {
      setOutput(prev => prev + `✗ Error searching libraries: ${error.message}\n`);
    }
  };

  const installBoard = async (boardCore) => {
    try {
      setOutput(prev => prev + `\nInstalling board: ${boardCore}...\n`);
      const response = await axios.post(`${API}/boards/install`, { core: boardCore });
      if (response.data.success) {
        setOutput(prev => prev + `✓ ${response.data.message}\n`);
        loadInstalledBoards();
      } else {
        setOutput(prev => prev + `✗ Failed to install board: ${response.data.error}\n`);
      }
    } catch (error) {
      setOutput(prev => prev + `✗ Error installing board: ${error.message}\n`);
    }
  };

  const uninstallBoard = async (boardCore) => {
    try {
      setOutput(prev => prev + `\nUninstalling board: ${boardCore}...\n`);
      const response = await axios.post(`${API}/boards/uninstall`, { core: boardCore });
      if (response.data.success) {
        setOutput(prev => prev + `✓ ${response.data.message}\n`);
        loadInstalledBoards();
      } else {
        setOutput(prev => prev + `✗ Failed to uninstall board: ${response.data.error}\n`);
      }
    } catch (error) {
      setOutput(prev => prev + `✗ Error uninstalling board: ${error.message}\n`);
    }
  };

  const installLibrary = async (libraryName) => {
    try {
      setOutput(prev => prev + `\nInstalling library: ${libraryName}...\n`);
      const response = await axios.post(`${API}/libraries/install`, { library: libraryName });
      if (response.data.success) {
        setOutput(prev => prev + `✓ ${response.data.message}\n`);
        loadInstalledLibraries();
      } else {
        setOutput(prev => prev + `✗ Failed to install library: ${response.data.error}\n`);
      }
    } catch (error) {
      setOutput(prev => prev + `✗ Error installing library: ${error.message}\n`);
    }
  };

  const uninstallLibrary = async (libraryName) => {
    try {
      setOutput(prev => prev + `\nUninstalling library: ${libraryName}...\n`);
      const response = await axios.post(`${API}/libraries/uninstall`, { library: libraryName });
      if (response.data.success) {
        setOutput(prev => prev + `✓ ${response.data.message}\n`);
        loadInstalledLibraries();
      } else {
        setOutput(prev => prev + `✗ Failed to uninstall library: ${response.data.error}\n`);
      }
    } catch (error) {
      setOutput(prev => prev + `✗ Error uninstalling library: ${error.message}\n`);
    }
  };

  const compileSketch = async () => {
    if (isCompiling) return;
    
    setIsCompiling(true);
    setOutput(prev => prev + '\n--- Compiling ---\n');
    setConsoleTab('compiler');
    
    try {
      const response = await axios.post(`${API}/compile`, {
        code: code,
        board: selectedBoard
      });
      
      if (response.data.success) {
        setOutput(prev => prev + '✓ Compilation successful!\n' + response.data.output + '\n');
      } else {
        setOutput(prev => prev + '✗ Compilation failed:\n' + response.data.error + '\n');
      }
    } catch (error) {
      setOutput(prev => prev + '✗ Compilation error: ' + error.message + '\n');
    } finally {
      setIsCompiling(false);
    }
  };

  const uploadSketch = async () => {
    if (isUploading || !selectedPort) {
      setOutput(prev => prev + '\n✗ Please select a port first\n');
      return;
    }
    
    setIsUploading(true);
    setOutput(prev => prev + '\n--- Uploading ---\n');
    setConsoleTab('compiler');
    
    try {
      const response = await axios.post(`${API}/upload`, {
        code: code,
        board: selectedBoard,
        port: selectedPort
      });
      
      if (response.data.success) {
        setOutput(prev => prev + '✓ Upload successful!\n' + response.data.output + '\n');
      } else {
        setOutput(prev => prev + '✗ Upload failed:\n' + response.data.error + '\n');
      }
    } catch (error) {
      setOutput(prev => prev + '✗ Upload error: ' + error.message + '\n');
    } finally {
      setIsUploading(false);
    }
  };

  const connectSerial = async () => {
    try {
      const response = await axios.post(`${API}/serial/connect`, {
        port: selectedPort,
        baud_rate: selectedBaudRate
      });
      
      if (response.data.success) {
        setIsSerialConnected(true);
        setSerialOutput(prev => prev + `✓ Connected to ${selectedPort} at ${selectedBaudRate} baud\n`);
        setConsoleTab('serial');
      } else {
        setSerialOutput(prev => prev + `✗ Failed to connect: ${response.data.error}\n`);
      }
    } catch (error) {
      setSerialOutput(prev => prev + `✗ Connection error: ${error.message}\n`);
    }
  };

  const disconnectSerial = async () => {
    try {
      await axios.post(`${API}/serial/disconnect?port=${selectedPort}`);
      setIsSerialConnected(false);
      setSerialOutput(prev => prev + `✓ Disconnected from ${selectedPort}\n`);
      if (wsRef.current) {
        wsRef.current.close();
      }
    } catch (error) {
      setSerialOutput(prev => prev + `✗ Disconnect error: ${error.message}\n`);
    }
  };

  const sendSerialData = async () => {
    if (!serialInput.trim()) return;
    
    try {
      await axios.post(`${API}/serial/send?port=${selectedPort}&data=${encodeURIComponent(serialInput)}`);
      setSerialOutput(prev => prev + `> ${serialInput}\n`);
      setSerialInput('');
    } catch (error) {
      setSerialOutput(prev => prev + `✗ Send error: ${error.message}\n`);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    if (!isAuthenticated) {
      setOutput(prev => prev + '\n✗ Please sign in with GitHub to create projects\n');
      return;
    }
    
    try {
      const response = await axios.post(`${API}/projects`, {
        name: newProjectName,
        code: code,
        is_public: newProjectPublic
      });
      
      setCurrentProject(response.data);
      setOutput(prev => prev + `\n✓ Project "${newProjectName}" created with GitHub repository!\n`);
      setNewProjectName('');
      setShowNewProject(false);
      loadProjects();
    } catch (error) {
      if (error.response?.status === 401) {
        logout();
      }
      setOutput(prev => prev + `\n✗ Failed to create project: ${error.message}\n`);
    }
  };

  const loadProject = async (project) => {
    try {
      const response = await axios.get(`${API}/projects/${project.id}`);
      setCurrentProject(response.data);
      setCode(response.data.code);
      setOutput(prev => prev + `\n✓ Loaded project: ${response.data.name}\n`);
    } catch (error) {
      if (error.response?.status === 401) {
        logout();
      }
      setOutput(prev => prev + `\n✗ Failed to load project: ${error.message}\n`);
    }
  };

  const saveProject = async () => {
    if (!currentProject) {
      setOutput(prev => prev + '\n✗ No project selected\n');
      return;
    }
    
    try {
      await axios.put(`${API}/projects/${currentProject.id}?code=${encodeURIComponent(code)}`);
      setOutput(prev => prev + `\n✓ Project saved to GitHub!\n`);
    } catch (error) {
      if (error.response?.status === 401) {
        logout();
      }
      setOutput(prev => prev + `\n✗ Failed to save project: ${error.message}\n`);
    }
  };

  // Render functions
  const renderBoardManager = () => (
    <Dialog open={showBoardManager} onOpenChange={setShowBoardManager}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Board Manager
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="installed" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="installed">Installed Boards</TabsTrigger>
            <TabsTrigger value="search">Search & Install</TabsTrigger>
          </TabsList>
          
          <TabsContent value="installed" className="space-y-4">
            <ScrollArea className="h-96">
              {installedBoards.map((board, index) => (
                <Card key={index} className="mb-2">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-medium">{board.name}</h4>
                        <p className="text-sm text-gray-500">ID: {board.id}</p>
                        {board.version && <Badge variant="secondary">{board.version}</Badge>}
                      </div>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => uninstallBoard(board.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Uninstall
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="search" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search boards (e.g., 'arduino', 'esp32')"
                value={boardSearchQuery}
                onChange={(e) => setBoardSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchBoards()}
              />
              <Button onClick={searchBoards}>
                <Search className="h-4 w-4 mr-1" />
                Search
              </Button>
            </div>
            <ScrollArea className="h-96">
              {boards.map((board, index) => (
                <Card key={index} className="mb-2">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-medium">{board.name}</h4>
                        <p className="text-sm text-gray-500">ID: {board.id}</p>
                        {board.version && <Badge variant="secondary">{board.version}</Badge>}
                      </div>
                      <Button 
                        variant="default" 
                        size="sm"
                        onClick={() => installBoard(board.id)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Install
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );

  const renderLibraryManager = () => (
    <Dialog open={showLibraryManager} onOpenChange={setShowLibraryManager}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Library Manager
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="installed" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="installed">Installed Libraries</TabsTrigger>
            <TabsTrigger value="search">Search & Install</TabsTrigger>
          </TabsList>
          
          <TabsContent value="installed" className="space-y-4">
            <ScrollArea className="h-96">
              {installedLibraries.map((library, index) => (
                <Card key={index} className="mb-2">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-medium">{library.name}</h4>
                        {library.author && <p className="text-sm text-gray-500">by {library.author}</p>}
                        {library.description && <p className="text-xs text-gray-400 mt-1">{library.description}</p>}
                      </div>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => uninstallLibrary(library.name)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Uninstall
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="search" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search libraries (e.g., 'servo', 'wifi', 'sensor')"
                value={librarySearchQuery}
                onChange={(e) => setLibrarySearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchLibraries()}
              />
              <Button onClick={searchLibraries}>
                <Search className="h-4 w-4 mr-1" />
                Search
              </Button>
            </div>
            <ScrollArea className="h-96">
              {libraries.map((library, index) => (
                <Card key={index} className="mb-2">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-medium">{library.name}</h4>
                        {library.author && <p className="text-sm text-gray-500">by {library.author}</p>}
                        {library.description && <p className="text-xs text-gray-400 mt-1">{library.description}</p>}
                        {library.versions && library.versions.length > 0 && (
                          <Badge variant="outline" className="mt-1">
                            Latest: {library.versions[library.versions.length - 1]}
                          </Badge>
                        )}
                      </div>
                      <Button 
                        variant="default" 
                        size="sm"
                        onClick={() => installLibrary(library.name)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Install
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSidebar(!showSidebar)}
            >
              {showSidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
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
            
            <Separator orientation="vertical" className="h-6" />
            
            <Button
              onClick={isSerialConnected ? disconnectSerial : connectSerial}
              variant={isSerialConnected ? "destructive" : "default"}
              size="sm"
              disabled={!selectedPort}
              className="flex items-center gap-2"
            >
              {isSerialConnected ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              {isSerialConnected ? 'Disconnect' : 'Connect'}
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
              {ports.map((port) => (
                <SelectItem key={port.device} value={port.device}>
                  {port.device}
                </SelectItem>
              ))}
              <SelectItem value="/dev/ttyUSB0">/dev/ttyUSB0</SelectItem>
              <SelectItem value="/dev/ttyUSB1">/dev/ttyUSB1</SelectItem>
              <SelectItem value="/dev/ttyACM0">/dev/ttyACM0</SelectItem>
              <SelectItem value="COM1">COM1</SelectItem>
              <SelectItem value="COM2">COM2</SelectItem>
              <SelectItem value="COM3">COM3</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedBaudRate.toString()} onValueChange={(value) => setSelectedBaudRate(parseInt(value))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="9600">9600</SelectItem>
              <SelectItem value="19200">19200</SelectItem>
              <SelectItem value="38400">38400</SelectItem>
              <SelectItem value="57600">57600</SelectItem>
              <SelectItem value="115200">115200</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            {isAuthenticated ? (
              <>
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
                        <Switch
                          id="isPublic"
                          checked={newProjectPublic}
                          onCheckedChange={setNewProjectPublic}
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
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={initiateGitHubAuth}>
                <Github className="h-4 w-4" />
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => setShowBoardManager(true)}>
              <Settings className="h-4 w-4" />
            </Button>

            <Button variant="outline" size="sm" onClick={() => setShowLibraryManager(true)}>
              <Package className="h-4 w-4" />
            </Button>

            {/* User Menu */}
            {isAuthenticated && user ? (
              <div className="flex items-center gap-2 ml-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.avatar_url} alt={user.username} />
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{user.username}</span>
                <Button variant="ghost" size="sm" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={initiateGitHubAuth}>
                <LogIn className="h-4 w-4 mr-1" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <div className="bg-white border-r border-gray-200 flex flex-col overflow-hidden" style={{width: `${sidebarWidth}px`}}>
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2">Projects</h3>
              {isAuthenticated ? (
                <ScrollArea className="h-40">
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
                </ScrollArea>
              ) : (
                <div className="text-sm text-gray-500 text-center py-4">
                  <Github className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p>Sign in with GitHub to manage projects</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={initiateGitHubAuth}>
                    <LogIn className="h-4 w-4 mr-1" />
                    Sign In
                  </Button>
                </div>
              )}
            </div>
            
            <div className="p-4 flex-1">
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
                <div className="flex items-center gap-2">
                  {isSerialConnected ? <Wifi className="h-4 w-4 text-green-600" /> : <WifiOff className="h-4 w-4 text-red-600" />}
                  <span>Serial: {isSerialConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
                {isAuthenticated && (
                  <div className="flex items-center gap-2">
                    <Github className="h-4 w-4 text-green-600" />
                    <span>GitHub: Connected</span>
                  </div>
                )}
              </div>
              
              <Separator className="my-4" />
              
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">Panels</h4>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Console</span>
                    <Switch checked={showConsole} onCheckedChange={setShowConsole} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Serial Monitor</span>
                    <Switch checked={showSerial} onCheckedChange={setShowSerial} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Serial Plotter</span>
                    <Switch checked={showPlotter} onCheckedChange={setShowPlotter} />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Resize handle for sidebar */}
            <div 
              className="w-1 bg-gray-300 cursor-col-resize hover:bg-blue-500 absolute right-0 top-0 h-full"
              style={{marginRight: '-2px'}}
            />
          </div>
        )}

        {/* Editor and Console Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Editor */}
          <div className="bg-white border-b border-gray-200" style={{height: `${editorHeight}%`}}>
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

          {/* Console/Serial/Plotter Area */}
          <div className="flex-1 bg-gray-900 text-green-400 font-mono overflow-hidden">
            <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center px-4 text-sm">
              <Tabs value={consoleTab} onValueChange={setConsoleTab} className="flex-1">
                <TabsList className="bg-gray-700">
                  {showConsole && (
                    <TabsTrigger value="compiler" className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Console
                    </TabsTrigger>
                  )}
                  {showSerial && (
                    <TabsTrigger value="serial" className="flex items-center gap-2">
                      <Monitor className="h-4 w-4" />
                      Serial Monitor
                    </TabsTrigger>
                  )}
                  {showPlotter && (
                    <TabsTrigger value="plotter" className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Serial Plotter
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (consoleTab === 'compiler') setOutput('');
                  else if (consoleTab === 'serial') setSerialOutput('');
                  else if (consoleTab === 'plotter') setSerialPlotterData([]);
                }}
                className="text-gray-400 hover:text-white ml-auto"
              >
                Clear
              </Button>
            </div>

            <div className="flex-1 overflow-hidden">
              {showConsole && consoleTab === 'compiler' && (
                <ScrollArea className="h-full p-4">
                  <pre className="text-sm whitespace-pre-wrap">{output}</pre>
                </ScrollArea>
              )}

              {showSerial && consoleTab === 'serial' && (
                <div className="h-full flex flex-col">
                  <ScrollArea className="flex-1 p-4">
                    <pre className="text-sm whitespace-pre-wrap">{serialOutput}</pre>
                  </ScrollArea>
                  {isSerialConnected && (
                    <div className="p-2 bg-gray-800 border-t border-gray-700 flex gap-2">
                      <Input
                        value={serialInput}
                        onChange={(e) => setSerialInput(e.target.value)}
                        placeholder="Send data to Arduino..."
                        className="flex-1 bg-gray-700 border-gray-600 text-white"
                        onKeyPress={(e) => e.key === 'Enter' && sendSerialData()}
                      />
                      <Button onClick={sendSerialData} size="sm">
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {showPlotter && consoleTab === 'plotter' && (
                <div className="h-full p-4">
                  <div className="bg-gray-800 rounded h-full flex items-center justify-center">
                    {serialPlotterData.length > 0 ? (
                      <div className="text-center">
                        <Activity className="h-8 w-8 mx-auto mb-2" />
                        <p>Plotting {serialPlotterData.length} data points</p>
                        <p className="text-xs text-gray-400">Last value: {serialPlotterData[serialPlotterData.length - 1]?.y}</p>
                      </div>
                    ) : (
                      <div className="text-center text-gray-400">
                        <BarChart3 className="h-8 w-8 mx-auto mb-2" />
                        <p>Serial Plotter</p>
                        <p className="text-xs">Send numeric data to see plot</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Resize handle for editor/console split */}
          <div 
            className="h-1 bg-gray-300 cursor-row-resize hover:bg-blue-500 absolute left-0 right-0"
            style={{top: `${editorHeight}%`, marginTop: '-2px'}}
          />
        </div>
      </div>

      {/* Dialogs */}
      {renderBoardManager()}
      {renderLibraryManager()}
    </div>
  );
}

export default App;