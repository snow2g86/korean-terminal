const { app, BrowserWindow, ipcMain, clipboard, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty');
const si = require('systeminformation');

// PTY sessions: id -> { pty, cols, rows }
const sessions = new Map();
let sessionCounter = 0;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: '한텀',
    icon: path.join(__dirname, 'build', 'icon.icns'),
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // queryLocalFonts API 허용
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'local-fonts') return callback(true);
    callback(true);
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// --- PTY IPC Handlers ---

ipcMain.handle('pty:create', (event, { cols, rows, cwd }) => {
  const id = ++sessionCounter;
  const shell = process.env.SHELL || '/bin/zsh';
  const env = Object.assign({}, process.env, {
    TERM: 'xterm-256color',
    LANG: 'ko_KR.UTF-8',
    LC_ALL: 'ko_KR.UTF-8',
  });

  // cwd 유효성 검사
  var startDir = cwd || process.env.HOME || os.homedir();
  try { if (!fs.statSync(startDir).isDirectory()) startDir = os.homedir(); } catch(e) { startDir = os.homedir(); }

  const ptyProcess = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: startDir,
    env: env,
  });

  sessions.set(id, { pty: ptyProcess, cols: cols || 80, rows: rows || 24 });

  // Forward PTY output to renderer
  ptyProcess.onData((data) => {
    if (!event.sender.isDestroyed()) event.sender.send('pty:data', { id, data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!event.sender.isDestroyed()) event.sender.send('pty:exit', { id, exitCode });
  });

  return id;
});

ipcMain.on('pty:write', (event, { id, data }) => {
  const session = sessions.get(id);
  if (session) session.pty.write(data);
});

ipcMain.on('pty:resize', (event, { id, cols, rows }) => {
  const session = sessions.get(id);
  if (session) {
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }
});

ipcMain.on('pty:destroy', (event, { id }) => {
  const session = sessions.get(id);
  if (session) {
    session.pty.kill();
    sessions.delete(id);
  }
});

// --- Directory listing IPC ---

ipcMain.handle('fs:listDir', async (event, { dir, filter, onlyDirs }) => {
  try {
    var targetDir = dir || os.homedir();
    var entries = fs.readdirSync(targetDir, { withFileTypes: true });
    var result = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.startsWith('.') && (!filter || !filter.startsWith('.'))) continue;
      var isDir = false;
      try { isDir = e.isDirectory(); } catch(err) {}
      if (onlyDirs && !isDir) continue;
      result.push({
        name: e.name,
        isDir: isDir,
        path: path.join(targetDir, e.name),
      });
    }
    result.sort(function(a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (filter) {
      var f = filter.toLowerCase();
      result = result.filter(function(item) {
        return item.name.toLowerCase().indexOf(f) === 0;
      });
    }
    return { entries: result, dir: targetDir };
  } catch (err) {
    return { entries: [], dir: dir || '', error: err.message };
  }
});

ipcMain.handle('pty:getCwd', async (event, { id }) => {
  var session = sessions.get(id);
  if (!session) return os.homedir();
  try {
    var { execFileSync } = require('child_process');
    var pid = session.pty.pid;
    var output = execFileSync('lsof', ['-p', String(pid), '-Fn'], { encoding: 'utf8', timeout: 2000 });
    var lines = output.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === 'fcwd' && lines[i + 1] && lines[i + 1].startsWith('n/')) {
        return lines[i + 1].substring(1);
      }
    }
    return os.homedir();
  } catch (e) {
    return os.homedir();
  }
});

// --- System Info IPC ---

ipcMain.handle('sysinfo', async () => {
  const { execFileSync } = require('child_process');
  const [cpu, cpuLoad, mem, net, osInfo] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.mem(),
    si.networkStats(),
    si.osInfo(),
  ]);

  // APFS-aware disk usage via df
  var mainDisk = {};
  try {
    var dfOut = execFileSync('df', ['-k', '/'], { encoding: 'utf8', timeout: 2000 });
    var parts = dfOut.split('\n')[1].split(/\s+/);
    var totalK = parseInt(parts[1]) || 0;
    var usedK = totalK - (parseInt(parts[3]) || 0); // total - available = real used
    mainDisk = { size: totalK * 1024, used: usedK * 1024, use: totalK > 0 ? (usedK / totalK * 100) : 0 };
  } catch(e) {
    mainDisk = { size: 0, used: 0, use: 0 };
  }
  const netTotal = net.reduce(
    (acc, n) => ({ tx: acc.tx + (n.tx_sec || 0), rx: acc.rx + (n.rx_sec || 0) }),
    { tx: 0, rx: 0 }
  );

  return {
    cpu: {
      model: cpu.brand || cpu.manufacturer,
      cores_physical: cpu.physicalCores,
      cores_logical: cpu.cores,
      percent: Math.round(cpuLoad.currentLoad * 10) / 10,
    },
    memory: {
      total_gb: Math.round((mem.total / 1073741824) * 10) / 10,
      used_gb: Math.round((mem.active / 1073741824) * 10) / 10,
      percent: Math.round((mem.active / mem.total) * 1000) / 10,
    },
    disk: {
      total_gb: Math.round(mainDisk.size / 1073741824 * 10) / 10,
      used_gb: Math.round(mainDisk.used / 1073741824 * 10) / 10,
      percent: Math.round(mainDisk.use * 10) / 10,
    },
    network: {
      sent_mbs: Math.round((netTotal.tx / 1048576) * 10) / 10,
      recv_mbs: Math.round((netTotal.rx / 1048576) * 10) / 10,
    },
    hostname: os.hostname(),
    os: osInfo.distro + ' ' + osInfo.release,
  };
});

// --- Input Source IPC (한/영 감지) ---

ipcMain.handle('ime:getSource', () => {
  try {
    const { execFileSync } = require('child_process');
    var out = execFileSync('defaults', ['read', 'com.apple.HIToolbox', 'AppleSelectedInputSources'], { encoding: 'utf8', timeout: 500 });
    if (out.indexOf('Korean') !== -1 || out.indexOf('korean') !== -1 || out.indexOf('HangulKeyboardLayout') !== -1) return 'ko';
    return 'en';
  } catch (e) {
    return 'en';
  }
});

// --- Clipboard IPC ---

ipcMain.handle('clipboard:read', () => {
  return clipboard.readText();
});

ipcMain.on('clipboard:write', (event, text) => {
  clipboard.writeText(text);
});

// --- Settings IPC ---

const settingsPath = path.join(app.getPath('userData'), 'layout.json');
const prefsPath = path.join(app.getPath('userData'), 'preferences.json');

ipcMain.handle('settings:load', async () => {
  try {
    var data = fs.readFileSync(settingsPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

ipcMain.on('settings:save', (event, data) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
});

// --- File Read/Write IPC ---

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch(e) { return null; }
});

ipcMain.on('fs:writeFile', (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch(e) {}
});

ipcMain.handle('fs:findFiles', async (event, { dir, pattern }) => {
  try {
    var results = [];
    function walk(d, depth) {
      if (depth > 3) return;
      var entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch(e) { return; }
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.name.startsWith('.') && e.name !== '.claude') continue;
        var full = path.join(d, e.name);
        if (e.isFile() && e.name.match(pattern)) {
          results.push({ name: e.name, path: full, dir: d });
        }
        if (e.isDirectory() && (e.name === '.claude' || e.name === 'docs')) {
          walk(full, depth + 1);
        }
      }
    }
    walk(dir, 0);
    return results;
  } catch(e) { return []; }
});

// --- File Dialog IPC ---

ipcMain.handle('dialog:openFile', async (event, opts) => {
  var result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    properties: ['openFile'],
    filters: opts.filters || [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  try {
    return fs.readFileSync(result.filePaths[0], 'utf8');
  } catch(e) { return null; }
});

ipcMain.handle('dialog:saveFile', async (event, { content, defaultName }) => {
  var result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
    defaultPath: defaultName || 'theme.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return true;
  } catch(e) { return false; }
});

// --- Preferences IPC ---

ipcMain.handle('prefs:load', async () => {
  try {
    var data = fs.readFileSync(prefsPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

ipcMain.on('prefs:save', (event, data) => {
  try {
    fs.writeFileSync(prefsPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
});

// --- App Lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Cleanup all PTY sessions
  sessions.forEach((s) => s.pty.kill());
  sessions.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
