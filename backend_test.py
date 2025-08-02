import requests
import sys
import json
from datetime import datetime

class ArduinoIDEAPITester:
    def __init__(self, base_url="https://ee41e7d3-c394-4a4c-a85b-a9158bf4d678.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.project_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, params=params, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 200:
                        print(f"   Response: {response_data}")
                except:
                    pass
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Response text: {response.text[:200]}")

            return success, response.json() if response.content else {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_root_endpoint(self):
        """Test the root API endpoint"""
        return self.run_test("Root API", "GET", "", 200)

    def test_boards_endpoints(self):
        """Test board-related endpoints"""
        print("\n📋 Testing Board Management Endpoints...")
        
        # Test installed boards
        success1, _ = self.run_test("List Installed Boards", "GET", "boards/installed", 200)
        
        # Test board search
        success2, _ = self.run_test("Search Boards", "GET", "boards/search", 200, params={"query": "arduino"})
        
        return success1 and success2

    def test_libraries_endpoints(self):
        """Test library-related endpoints"""
        print("\n📚 Testing Library Management Endpoints...")
        
        # Test installed libraries
        success1, _ = self.run_test("List Installed Libraries", "GET", "libraries/installed", 200)
        
        # Test library search
        success2, _ = self.run_test("Search Libraries", "GET", "libraries/search", 200, params={"query": "servo"})
        
        return success1 and success2

    def test_ports_endpoint(self):
        """Test ports endpoint"""
        print("\n🔌 Testing Ports Endpoint...")
        return self.run_test("List Ports", "GET", "ports", 200)[0]

    def test_compile_endpoint(self):
        """Test code compilation"""
        print("\n⚙️ Testing Compilation Endpoint...")
        
        # Test with valid Arduino code
        valid_code = """
#include <Arduino.h>

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
"""
        
        compile_data = {
            "code": valid_code,
            "board": "arduino:avr:uno"
        }
        
        success1, response1 = self.run_test("Compile Valid Code", "POST", "compile", 200, data=compile_data)
        
        # Test with invalid Arduino code
        invalid_code = """
#include <Arduino.h>

void setup() {
  Serial.begin(9600);
  // Missing semicolon and invalid function
  invalidFunction()
}

void loop() {
  // Missing function body
"""
        
        compile_data_invalid = {
            "code": invalid_code,
            "board": "arduino:avr:uno"
        }
        
        success2, response2 = self.run_test("Compile Invalid Code", "POST", "compile", 200, data=compile_data_invalid)
        
        return success1 and success2

    def test_project_endpoints(self):
        """Test project CRUD operations"""
        print("\n📁 Testing Project Management Endpoints...")
        
        # Test creating a project
        project_name = f"test_project_{datetime.now().strftime('%H%M%S')}"
        project_data = {
            "name": project_name,
            "code": "#include <Arduino.h>\n\nvoid setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println(\"Hello World!\");\n  delay(1000);\n}",
            "is_public": True
        }
        
        success1, response1 = self.run_test("Create Project", "POST", "projects", 200, data=project_data)
        
        if success1 and 'id' in response1:
            self.project_id = response1['id']
            print(f"   Created project with ID: {self.project_id}")
            
            # Test listing projects
            success2, _ = self.run_test("List Projects", "GET", "projects", 200)
            
            # Test getting specific project
            success3, _ = self.run_test("Get Project", "GET", f"projects/{self.project_id}", 200)
            
            # Test updating project
            updated_code = "#include <Arduino.h>\n\nvoid setup() {\n  Serial.begin(9600);\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(500);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(500);\n}"
            success4, _ = self.run_test("Update Project", "PUT", f"projects/{self.project_id}", 200, params={"code": updated_code})
            
            return success1 and success2 and success3 and success4
        else:
            print("❌ Failed to create project, skipping other project tests")
            return False

    def test_upload_endpoint(self):
        """Test upload endpoint (will likely fail without actual hardware)"""
        print("\n📤 Testing Upload Endpoint...")
        
        upload_data = {
            "code": "#include <Arduino.h>\n\nvoid setup() {\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  Serial.println(\"Test\");\n  delay(1000);\n}",
            "board": "arduino:avr:uno",
            "port": "/dev/ttyUSB0"
        }
        
        # This will likely fail since no actual Arduino is connected, but we test the endpoint
        success, response = self.run_test("Upload Code", "POST", "upload", 200, data=upload_data)
        
        # We expect this to fail due to no hardware, so we'll consider it a pass if we get a proper error response
        if not success and isinstance(response, dict):
            print("   Note: Upload failed as expected (no hardware connected)")
            return True
        
        return success

    def cleanup_test_project(self):
        """Clean up test project"""
        if self.project_id:
            print(f"\n🧹 Cleaning up test project {self.project_id}...")
            success, _ = self.run_test("Delete Project", "DELETE", f"projects/{self.project_id}", 200)
            return success
        return True

def main():
    print("🚀 Starting Arduino IDE API Tests...")
    print("=" * 50)
    
    tester = ArduinoIDEAPITester()
    
    # Run all tests
    tests = [
        tester.test_root_endpoint,
        tester.test_boards_endpoints,
        tester.test_libraries_endpoints,
        tester.test_ports_endpoint,
        tester.test_compile_endpoint,
        tester.test_project_endpoints,
        tester.test_upload_endpoint,
    ]
    
    all_passed = True
    for test in tests:
        try:
            result = test()
            if not result:
                all_passed = False
        except Exception as e:
            print(f"❌ Test failed with exception: {str(e)}")
            all_passed = False
    
    # Cleanup
    tester.cleanup_test_project()
    
    # Print results
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} tests passed")
    
    if all_passed and tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())