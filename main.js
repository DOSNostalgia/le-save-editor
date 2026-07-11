// Auto-detect system Electron
function findElectron() {
  const paths = [
    "/usr/lib/electron42/electron",
    "/usr/lib/electron41/electron",
    "/usr/lib/electron40/electron",
    "/usr/lib/electron39/electron",
    "/usr/lib/electron38/electron",
    "/usr/lib/electron37/electron",
    "/usr/lib/electron36/electron",
    "/usr/lib/electron35/electron",
    "/usr/lib/electron34/electron",
    "/usr/lib/electron33/electron",
    "/usr/lib/electron/electron",
  ];
  for (const p of paths) {
    if (require("fs").existsSync(p)) return p;
  }
  // Fall back to npx electron (npm-installed)
  return null;
}
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let mainWindow = null;
let serverProcess = null;
let serverExited = false;
const SERVER_URL = "http://127.0.0.1:17345";
const SERVER_SCRIPT = path.join(__dirname, "server.js");

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

  // Start Node backend
  serverProcess = spawn(process.execPath, [SERVER_SCRIPT], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[server] ${data}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`Server process exited with code ${code}`);
    serverExited = true;
  });

  // Consume stdout to prevent pipe buffer deadlock
  serverProcess.stdout.on("data", () => {});

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
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});