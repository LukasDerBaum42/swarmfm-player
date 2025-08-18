const { app, BrowserWindow, Tray, Menu, shell, net, ipcMain, session } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
// Remove electron-store since it's not needed for this player
let mainWindow = null;
let tray = null;
let reloadTimeout = null;
let isOnline = true;

// URLs configuration
const PLAYER_URL = 'https://player.sw.arm.fm/';
const STATUS_URL = 'https://status.sw.arm.fm/';
const DISCORD_URL = 'https://discord.gg/SyHegkDmeF';
const ICON_ONLINE = path.join(__dirname, 'icon.png');
const ICON_OFFLINE = path.join(__dirname, 'icon-offline.png');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function updateTrayStatus(isOnline) {
  if (!tray) return;
  tray.setImage(isOnline ? ICON_ONLINE : ICON_OFFLINE);
  tray.setToolTip(`Swarm FM Player - ${isOnline ? "Online" : "Offline"}`);
}

function createMainWindow() {
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

  // Create main browser window
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    icon: ICON_ONLINE,
    show: false,
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
  mainWindowState.manage(mainWindow);

  // Handle minimize event
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  // Handle window closed event
  mainWindow.on('closed', () => {
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
      reloadTimeout = null;
    }
    mainWindow = null;
  });

  // Media session integration
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
          document.querySelector('[data-action="play"], .play')?.click();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          document.querySelector('[data-action="pause"], .pause')?.click();
        });
      }
    `);
  });

  // Session persistence
  const ses = mainWindow.webContents.session;
  ses.clearStorageData();
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'notifications');
  });

  // Enhanced network detection
  const checkNetworkStatus = () => {
    const newStatus = net.isOnline();
    if (newStatus !== isOnline) {
      isOnline = newStatus;
      console.log(`Network status changed: ${isOnline ? 'Online' : 'Offline'}`);
      updateTrayStatus(isOnline);
      
      if (!isOnline) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showOfflinePage();
        }
      } else if (isOnline && mainWindow && !mainWindow.isDestroyed() && 
                mainWindow.webContents.getURL().startsWith('data:text/html')) {
        loadPlayer();
      }
    }
  };

  // Initial network status
  isOnline = net.isOnline();
  updateTrayStatus(isOnline);
  
  // Check network status every 5 seconds
  const networkCheckInterval = setInterval(checkNetworkStatus, 5000);
  mainWindow.on('closed', () => clearInterval(networkCheckInterval));

  // Load player
  const loadPlayer = () => {
    if (!isOnline) {
      showOfflinePage();
      return;
    }

    mainWindow.loadURL(PLAYER_URL, {
      userAgent: mainWindow.webContents.getUserAgent() + ' SwarmFMElectron/1.0',
      extraHeaders: "Content-Security-Policy: default-src 'self' https://*.sw.arm.fm; " +
                   "script-src 'self' 'unsafe-inline' https://*.sw.arm.fm; " +
                   "style-src 'self' 'unsafe-inline' https://*.sw.arm.fm; " +
                   "img-src 'self' https://*.sw.arm.fm data:; " +
                   "media-src https://*.sw.arm.fm; " +
                   "connect-src https://*.sw.arm.fm;"
    })
      .then(() => {
        console.log('Player loaded successfully');
        mainWindow.show();
        
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
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
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
            <button onclick="window.openExternal('${STATUS_URL}')">🛟 Check Status</button>
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

    mainWindow.show();
    
    // Schedule reload only if window still exists
    if (!mainWindow.isDestroyed()) {
      reloadTimeout = setTimeout(loadPlayer, 10000);
    }
  };

  const showOfflinePage = () => {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
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
    
    mainWindow.show();
    
    // Schedule retry with exponential backoff
    const retryDelay = Math.min(30000, 1000 * Math.pow(2, reloadTimeout ? 3 : 1));
    reloadTimeout = setTimeout(loadPlayer, retryDelay);
  };

  // Restrict navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    const allowedHosts = ['player.sw.arm.fm', 'sw.arm.fm'];
    
    if (!allowedHosts.includes(parsedUrl.hostname)) {
      event.preventDefault();
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        shell.openExternal(url);
      }
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Handle Discord links specially
    if (url.includes('discord.gg/') || url.includes('discord.com/')) {
      // Try Discord app first
      shell.openExternal(`discord://discord.gg/SyHegkDmeF`);
      
      // Fallback to web after delay
      setTimeout(() => {
        shell.openExternal(DISCORD_URL);
      }, 300);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent crashes on failed resources
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.warn('Resource failed to load:', errorDescription);
  });

  // Performance monitoring
  mainWindow.webContents.on('did-finish-load', () => {
    setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.getProcessMemoryInfo().then(info => {
          if (info.privateBytes > 500000000) { // 500MB
            mainWindow.webContents.reloadIgnoringCache();
          }
        });
      }
    }, 60000); // Check every minute
  });

  // Start loading
  loadPlayer();
}

app.whenReady().then(() => {
  // Create main window after a short delay
  setTimeout(createMainWindow, 100);
  
  // Set up application menu
  const template = [
    {
      label: 'Swarm FM',
      submenu: [
        { 
          label: 'Reload Player',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.reload()
        },
        { 
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.reloadIgnoringCache()
        },
        { type: 'separator' },
        { 
          label: 'Swarm FM Discord',
          click: () => {
            shell.openExternal(`discord://discord.gg/SyHegkDmeF`);
            setTimeout(() => {
              shell.openExternal(DISCORD_URL);
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
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-about');
            }
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Set up system tray
  tray = new Tray(ICON_ONLINE);
  tray.setToolTip('Swarm FM Player');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Pause/Play',
      click: () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.executeJavaScript(`
              // Try to find a pause or play button and click it
              const pauseBtn = document.querySelector('[data-action="pause"], .pause, .fa-pause, [title="Pause"]');
              const playBtn = document.querySelector('[data-action="play"], .play, .fa-play, [title="Play"]');
              if (pauseBtn && pauseBtn.offsetParent !== null) {
                pauseBtn.click();
              } else if (playBtn && playBtn.offsetParent !== null) {
                playBtn.click();
              }
            `);
          }
        } catch (error) {
          console.error('Error toggling pause/play:', error);
        }
      }
    },
    { 
      label: 'Show Player', 
      click: () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createMainWindow();
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
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
        } catch (error) {
          console.error('Error hiding player:', error);
        }
      } 
    },
    { 
      label: 'Reload Player', 
      click: () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
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
            shell.openExternal(DISCORD_URL);
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.openDevTools({ mode: 'detach' });
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
      if (!mainWindow || mainWindow.isDestroyed()) return createMainWindow();
      
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.show();
      } else if (!mainWindow.isVisible()) {
        mainWindow.show();
      } else {
        mainWindow.hide();
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available');
    }
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('No update available');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available');
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
    
    // Notify user and install on next restart
    const dialog = require('electron').dialog;
    dialog.showMessageBox(mainWindow, {
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', err.message);
    }
  });
  
  // Check for updates on launch
  autoUpdater.checkForUpdatesAndNotify();
});

// Handle IPC events
ipcMain.on('retry-load', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
  }
});

// Enhanced crash prevention
app.on('render-process-gone', (event, webContents, details) => {
  console.error('Renderer process crashed:', details);
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
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
