const { app, BrowserWindow, Tray, Menu, shell, net, ipcMain } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Disable hardware acceleration to prevent Steam conflicts
app.disableHardwareAcceleration();

// Disable GPU process to prevent crashes
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

let win = null;
let tray = null;
let reloadTimeout = null;
let isOnline = true;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function createWindow() {
  // Clear any existing reload timeout
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
    reloadTimeout = null;
  }

  // Load window state with defaults
  const mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 600
  });

  // Create browser window with more stable configuration
  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    icon: path.join(__dirname, 'icon.png'),
    show: false, // Don't show until content is loaded
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      plugins: false,
      disableBlinkFeatures: 'Auxclick',
      enableWebSQL: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Manage window state
  mainWindowState.manage(win);

  // Handle minimize event safely
  win.on('minimize', (event) => {
    event.preventDefault();
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  });

  // Handle window closed event
  win.on('closed', () => {
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
      reloadTimeout = null;
    }
    win = null;
  });

  // Load player with robust error handling
  const loadPlayer = () => {
    if (!isOnline) {
      showOfflinePage();
      return;
    }

    win.loadURL('https://player.sw.arm.fm/', {
      userAgent: win.webContents.getUserAgent() + ' SwarmFMElectron/1.0'
    })
      .then(() => {
        console.log('Player loaded successfully');
        win.show(); // Show window only after successful load
        
        // Clear any pending reload
        if (reloadTimeout) {
          clearTimeout(reloadTimeout);
          reloadTimeout = null;
        }
      })
      .catch(err => {
        console.error('Failed to load player:', err);
        showErrorPage(err);
      });
  };

  const showErrorPage = (err) => {
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Swarm FM Player Error</title>
        <style>
          body {
            background: #1a1a1a;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
            padding: 20px;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .error-container {
            max-width: 600px;
            padding: 30px;
            background: rgba(30, 30, 30, 0.8);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          }
          h1 {
            color: #ff6b6b;
            margin-top: 0;
          }
          p {
            line-height: 1.6;
            margin-bottom: 25px;
            color: #ddd;
          }
          .button-group {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
          }
          button {
            background: #4CAF50;
            border: none;
            color: white;
            padding: 12px 24px;
            cursor: pointer;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.2s ease;
            min-width: 140px;
          }
          button:hover {
            background: #45a049;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          }
          #retry-btn {
            background: #2196F3;
          }
          #retry-btn:hover {
            background: #0b7dda;
          }
          .error-details {
            margin-top: 25px;
            padding: 15px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 6px;
            font-family: monospace;
            font-size: 14px;
            max-height: 100px;
            overflow-y: auto;
            text-align: left;
            color: #ff9999;
            display: none;
            width: 100%;
          }
          .show-details {
            color: #aaa;
            font-size: 0.9em;
            margin-top: 15px;
            cursor: pointer;
            text-decoration: underline;
          }
          .status {
            margin-top: 25px;
            font-size: 0.9em;
            color: #aaa;
          }
          .online-status {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 10px;
          }
          .online-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: ${isOnline ? '#4CAF50' : '#f44336'};
          }
          .update-notification {
            margin-top: 20px;
            padding: 10px;
            background: rgba(33, 150, 243, 0.2);
            border-radius: 6px;
            font-size: 0.9em;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>Swarm FM Player Error</h1>
          <p>Failed to load player: ${err.message || 'Unknown error'}</p>
          
          <div class="button-group">
            <button id="retry-btn" onclick="window.retryLoad()">↻ Reload Player</button>
            <button onclick="window.openExternal('https://status.sw.arm.fm')">🛟 Check Status</button>
          </div>
          
          <div class="show-details" onclick="document.querySelector('.error-details').style.display = 'block'; this.style.display = 'none'">
            Show Technical Details
          </div>
          
          <div class="error-details">
            Error: ${err.toString()}<br><br>
            ${err.stack || ''}
          </div>
          
          <div class="status">
            Trying again in <span id="countdown">10</span> seconds...
          </div>
          
          <div class="online-status">
            <div class="online-dot"></div>
            <span>${isOnline ? 'Online' : 'Offline'}</span>
          </div>
          
          <div class="update-notification" id="updateNotification" style="display: none;">
            <strong>Update Available!</strong> A new version is downloading in the background.
          </div>
        </div>
        
        <script>
          // Countdown timer
          let seconds = 10;
          const countdownEl = document.getElementById('countdown');
          
          const countdown = setInterval(() => {
            seconds--;
            countdownEl.textContent = seconds;
            if (seconds <= 0) clearInterval(countdown);
          }, 1000);
          
          // External link handler
          window.openExternal = (url) => {
            require('electron').shell.openExternal(url);
          };
          
          // Retry load function
          window.retryLoad = () => {
            require('electron').ipcRenderer.send('retry-load');
          };
          
          // Listen for update notifications
          require('electron').ipcRenderer.on('update-available', () => {
            document.getElementById('updateNotification').style.display = 'block';
          });
        </script>
      </body>
      </html>
    `)}`);

    win.show(); // Show error page
    
    // Schedule reload only if window still exists
    if (!win.isDestroyed()) {
      reloadTimeout = setTimeout(loadPlayer, 10000);
    }
  };

  const showOfflinePage = () => {
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Offline - Swarm FM Player</title>
        <style>
          body {
            background: #1a1a1a;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
            padding: 20px;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .offline-container {
            max-width: 500px;
          }
          h1 {
            color: #ff6b6b;
          }
          p {
            color: #ddd;
            line-height: 1.6;
          }
          .retry-btn {
            background: #2196F3;
            border: none;
            color: white;
            padding: 12px 24px;
            margin: 20px 0;
            cursor: pointer;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            transition: background 0.2s;
          }
          .retry-btn:hover {
            background: #0b7dda;
          }
          .network-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          .auto-retry {
            margin-top: 20px;
            color: #aaa;
          }
          .update-notification {
            margin-top: 20px;
            padding: 10px;
            background: rgba(33, 150, 243, 0.2);
            border-radius: 6px;
            font-size: 0.9em;
          }
        </style>
      </head>
      <body>
        <div class="offline-container">
          <div class="network-icon">📡</div>
          <h1>Connection Lost</h1>
          <p>Swarm FM Player requires an internet connection. Please check your network settings.</p>
          <button class="retry-btn" onclick="window.retryLoad()">Retry Connection</button>
          <p class="auto-retry">Trying to reconnect automatically...</p>
          
          <div class="update-notification" id="updateNotification" style="display: none;">
            <strong>Update Available!</strong> A new version is downloading in the background.
          </div>
        </div>
        
        <script>
          // Retry load function
          window.retryLoad = () => {
            require('electron').ipcRenderer.send('retry-load');
          };
          
          // Listen for update notifications
          require('electron').ipcRenderer.on('update-available', () => {
            document.getElementById('updateNotification').style.display = 'block';
          });
        </script>
      </body>
      </html>
    `)}`);
    
    win.show();
    
    // Schedule retry with exponential backoff
    const retryDelay = Math.min(30000, 1000 * Math.pow(2, reloadTimeout ? 3 : 1));
    reloadTimeout = setTimeout(loadPlayer, retryDelay);
  };

  // Network status monitoring
  const checkNetworkStatus = () => {
    const newStatus = net.isOnline();
    if (newStatus !== isOnline) {
      isOnline = newStatus;
      console.log(`Network status changed: ${isOnline ? 'Online' : 'Offline'}`);
      
      if (!isOnline) {
        if (win && !win.isDestroyed()) {
          showOfflinePage();
        }
      } else if (win && !win.isDestroyed() && win.webContents.getURL().startsWith('data:text/html')) {
        loadPlayer();
      }
    }
  };

  // Initial network status
  isOnline = net.isOnline();
  
  // Check network status every 5 seconds
  const networkCheckInterval = setInterval(checkNetworkStatus, 5000);
  win.on('closed', () => clearInterval(networkCheckInterval));

  // Restrict navigation to the same domain
  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL();
    const targetHost = new URL(url).hostname;
    const allowedHosts = ['player.sw.arm.fm', 'sw.arm.fm'];
    
    if (!allowedHosts.includes(targetHost) && !currentUrl.startsWith('data:text/html')) {
      event.preventDefault();
    }
  });

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Handle Discord links specially
    if (url.includes('discord.gg/') || url.includes('discord.com/')) {
      // Try Discord app first
      shell.openExternal(`discord://discord.gg/SyHegkDmeF`);
      
      // Fallback to web after delay
      setTimeout(() => {
        shell.openExternal('https://discord.gg/SyHegkDmeF');
      }, 300);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent crashes on failed resources
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.warn('Resource failed to load:', errorDescription);
  });

  // Start loading
  loadPlayer();
}

app.whenReady().then(() => {
  // Create window after a short delay for stability
  setTimeout(createWindow, 100);
  
  // Set up application menu
  const template = [
    {
      label: 'Swarm FM',
      submenu: [
        { 
          label: 'Reload Player',
          accelerator: 'CmdOrCtrl+R',
          click: () => win && !win.isDestroyed() && win.reload()
        },
        { 
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win && !win.isDestroyed() && win.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        { 
          label: 'Swarm FM Discord',
          click: () => {
            // Try Discord app first
            shell.openExternal(`discord://discord.gg/SyHegkDmeF`);
            
            // Fallback to web after delay
            setTimeout(() => {
              shell.openExternal('https://discord.gg/SyHegkDmeF');
            }, 300);
          }
        },
        { 
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/LukasDerBaum42/swarmfm-player/issues')
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { 
          label: 'Check for Updates',
          click: () => autoUpdater.checkForUpdatesAndNotify()
        },
        { 
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/LukasDerBaum42/swarmfm-player/wiki')
        },
        { type: 'separator' },
        { 
          label: 'About Swarm FM Player',
          click: () => {
            if (win && !win.isDestroyed()) {
              win.webContents.send('show-about');
            }
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Set up system tray
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setToolTip('Swarm FM Player');
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show Player', 
      click: () => {
        try {
          if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          } else {
            createWindow();
          }
        } catch (error) {
          console.error('Error showing player:', error);
        }
      }
    },
    { 
      label: 'Hide Player', 
      click: () => {
        try {
          if (win && !win.isDestroyed()) win.hide();
        } catch (error) {
          console.error('Error hiding player:', error);
        }
      } 
    },
    { 
      label: 'Reload Player', 
      click: () => {
        try {
          if (win && !win.isDestroyed()) win.reload();
        } catch (error) {
          console.error('Error reloading player:', error);
        }
      }
    },
    { type: 'separator' },
    { 
      label: 'Swarm FM Discord', 
      click: () => {
        try {
          shell.openExternal(`discord://discord.gg/SyHegkDmeF`);
          setTimeout(() => {
            shell.openExternal('https://discord.gg/SyHegkDmeF');
          }, 300);
        } catch (error) {
          console.error('Error opening Discord:', error);
        }
      }
    },
    { 
      label: 'Check for Updates', 
      click: () => autoUpdater.checkForUpdatesAndNotify()
    },
    { 
      label: 'Developer Tools', 
      click: () => {
        if (win && !win.isDestroyed()) {
          win.webContents.openDevTools({ mode: 'detach' });
        }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);

  // Tray click behavior
  tray.on('click', () => {
    try {
      if (!win || win.isDestroyed()) return createWindow();
      
      if (win.isMinimized()) {
        win.restore();
        win.show();
      } else if (!win.isVisible()) {
        win.show();
      } else {
        win.hide();
      }
    } catch (error) {
      console.error('Error handling tray click:', error);
    }
  });
  
  // Set up auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('Update available', info.version);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-available');
    }
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('No update available');
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-not-available');
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded', info.version);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-downloaded');
    }
    
    // Notify user and install on next restart
    const dialog = require('electron').dialog;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded. Restart the application to apply the update?`,
      buttons: ['Restart Now', 'Later']
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
  
  autoUpdater.on('error', (err) => {
    console.error('Updater error:', err);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-error', err.message);
    }
  });
  
  // Check for updates on launch
  autoUpdater.checkForUpdatesAndNotify();
});

// Handle IPC events
ipcMain.handle('retry-load', () => {
  if (win && !win.isDestroyed()) {
    win.reload();
  }
});

// Enhanced crash prevention
app.on('render-process-gone', (event, webContents, details) => {
  console.error('Renderer process crashed:', details);
  event.preventDefault();
  if (win && !win.isDestroyed()) {
    win.reload();
  }
});

app.on('child-process-gone', (event, details) => {
  console.error('Child process gone:', details);
  event.preventDefault();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!win || win.isDestroyed()) {
    createWindow();
  }
});

// Clean up on exit
app.on('will-quit', () => {
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
  }
  
  if (tray) {
    tray.destroy();
  }
});

// Add global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
