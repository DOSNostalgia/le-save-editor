const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let mainWindow = null;
let pythonProcess = null;
let pythonExited = false;
const SERVER_URL = "http://127.0.0.1:17345";
const PYTHON_VENV = path.join(__dirname, ".venv", "bin", "python");
const SERVER_SCRIPT = path.join(__dirname, "server.py");

function waitForServer(callback, retries = 30) {
  const check = () => {
    http.get(`${SERVER_URL}/api/health`, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        if (res.statusCode === 200) {
          callback(null, JSON.parse(data));
        } else if (retries > 0) {
          setTimeout(() => waitForServer(callback, retries - 1), 300);
        } else {
          callback(new Error("Server health check failed"));
        }
      });
    }).on("error", () => {
      if (retries > 0) {
        setTimeout(() => waitForServer(callback, retries - 1), 300);
      } else {
        callback(new Error("Server not responding after 30 retries"));
      }
    });
  };
  check();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Last Epoch Save Editor",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.setMenuBarVisibility(false);

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Single-instance lock — prevent port conflict on 17345
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.error("Another instance is already running. Exiting.");
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Start Python backend
  const pythonPath = require("fs").existsSync(PYTHON_VENV) ? PYTHON_VENV : "python3";
  pythonProcess = spawn(pythonPath, [SERVER_SCRIPT], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
  });

  pythonProcess.stderr.on("data", (data) => {
    console.error(`[python] ${data}`);
  });

  pythonProcess.on("exit", (code) => {
    console.log(`Python server exited with code ${code}`);
    pythonExited = true;
  });

  // Consume stdout to prevent pipe buffer deadlock
  pythonProcess.stdout.on("data", () => {});

  // Wait for server, then create window
  waitForServer((err, health) => {
    if (err) {
      console.error("Failed to start Python server:", err.message);
      // Create window anyway — it will show an error
    }
    createWindow();
  });
});

app.on("window-all-closed", () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});